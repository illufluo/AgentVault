const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const BASE_WINDOW = 3600n;
const PAYMENT_AMOUNT = ethers.parseEther("0.005");

describe("AgentVault integration scenarios", function () {
  async function deployScenarioFixture() {
    const [stakeholder1, stakeholder2, stakeholder3, agent, recipient, outsider] = await ethers.getSigners();

    const AgentVault = await ethers.getContractFactory("AgentVault");
    const vault = await AgentVault.deploy(
      [stakeholder1.address, stakeholder2.address, stakeholder3.address],
      2
    );
    await vault.waitForDeployment();

    await stakeholder1.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("5") });
    await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
    await vault.connect(stakeholder2).approveProposal(0);

    return { vault, stakeholder1, stakeholder2, stakeholder3, agent, recipient, outsider };
  }

  function getEventIndex(receipt, contract, eventName) {
    const topic = contract.interface.getEvent(eventName).topicHash;
    return receipt.logs.findIndex((log) => log.topics[0] === topic);
  }

  describe("Scenario A: optimistic execution success", function () {
    it("submits, waits, and executes optimistically with a reputation increase", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployScenarioFixture);
      const vaultAddress = await vault.getAddress();
      const intentHash = ethers.id("scenario-a: pay recipient");

      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vaultAddress);
      const submitTx = await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, intentHash);
      await expect(submitTx)
        .to.emit(vault, "PaymentRequested")
        .withArgs(0, agent.address, recipient.address, PAYMENT_AMOUNT, intentHash, await time.latest() + Number(BASE_WINDOW));
      const submitReceipt = await submitTx.wait();
      const submitBlock = await ethers.provider.getBlock(submitReceipt.blockNumber);

      const requestBefore = await vault.getRequest(0);
      expect(requestBefore.status).to.equal(0n);
      expect(requestBefore.executableAt).to.equal(BigInt(submitBlock.timestamp) + BASE_WINDOW);
      expect(await vault.currentWindow(agent.address)).to.equal(BASE_WINDOW);

      await time.increase(Number(BASE_WINDOW + 1n));

      const executeTx = await vault.connect(outsider).execute(0);
      await expect(executeTx).to.emit(vault, "PaymentExecuted").withArgs(0);
      await expect(executeTx)
        .to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, 0, 1, "SUCCESS");
      const executeReceipt = await executeTx.wait();

      const requestAfter = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(requestAfter.status).to.equal(1n);
      expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientBalanceBefore + PAYMENT_AMOUNT);
      expect(await ethers.provider.getBalance(vaultAddress)).to.equal(vaultBalanceBefore - PAYMENT_AMOUNT);
      expect(profile.reputation).to.equal(1);
      expect(profile.successCount).to.equal(1n);
      expect(profile.vetoCount).to.equal(0n);
      expect(submitReceipt.blockNumber).to.be.lessThan(executeReceipt.blockNumber);
      expect(getEventIndex(executeReceipt, vault, "PaymentExecuted"))
        .to.be.lessThan(getEventIndex(executeReceipt, vault, "ReputationChanged"));
    });
  });

  describe("Scenario B: stakeholder veto", function () {
    it("allows one stakeholder to veto and blocks later execution", async function () {
      const { vault, stakeholder3, agent, recipient, outsider } = await loadFixture(deployScenarioFixture);
      const vaultBalanceBefore = await ethers.provider.getBalance(await vault.getAddress());
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);
      const intentHash = ethers.id("scenario-b: vetoed payment");

      await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, intentHash);
      const requestBefore = await vault.getRequest(0);
      expect(requestBefore.status).to.equal(0n);

      await expect(vault.connect(stakeholder3).veto(0))
        .to.emit(vault, "PaymentVetoed")
        .withArgs(0, stakeholder3.address)
        .and.to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, 0, -3, "VETO");

      const requestAfter = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(requestAfter.status).to.equal(2n);
      expect(requestAfter.vetoedBy).to.equal(stakeholder3.address);
      expect(profile.reputation).to.equal(-3);
      expect(profile.successCount).to.equal(0n);
      expect(profile.vetoCount).to.equal(1n);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(vaultBalanceBefore);
      expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientBalanceBefore);

      await expect(vault.connect(outsider).execute(0))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });
  });

  describe("Scenario C: reputation drives window and limit", function () {
    it("changes dynamic window and limit after successes and a veto", async function () {
      const { vault, stakeholder3, agent, recipient, outsider } = await loadFixture(deployScenarioFixture);

      expect(await vault.currentWindow(agent.address)).to.equal(3600n);
      expect(await vault.currentLimit(agent.address)).to.equal(ethers.parseEther("0.01"));

      for (let i = 0; i < 5; i++) {
        const window = await vault.currentWindow(agent.address);
        const tx = await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, ethers.id(`scenario-c-success-${i}`));
        await expect(tx).to.emit(vault, "PaymentRequested");
        await time.increase(Number(window + 1n));
        await expect(vault.connect(outsider).execute(i))
          .to.emit(vault, "PaymentExecuted")
          .withArgs(i);
      }

      const profileAfterSuccesses = await vault.getAgentProfile(agent.address);
      expect(profileAfterSuccesses.reputation).to.equal(5);
      expect(profileAfterSuccesses.successCount).to.equal(5n);
      expect(await vault.currentWindow(agent.address)).to.equal(3450n);
      expect(await vault.currentLimit(agent.address)).to.equal(ethers.parseEther("0.06"));

      await expect(vault.connect(agent).submit(recipient.address, ethers.parseEther("0.05"), ethers.id("scenario-c-within-limit")))
        .to.emit(vault, "PaymentRequested");
      await expect(vault.connect(agent).submit(recipient.address, ethers.parseEther("0.061"), ethers.id("scenario-c-over-limit")))
        .to.be.revertedWithCustomError(vault, "AmountExceedsLimit");

      await vault.connect(agent).submit(recipient.address, PAYMENT_AMOUNT, ethers.id("scenario-c-veto"));
      await expect(vault.connect(stakeholder3).veto(6))
        .to.emit(vault, "PaymentVetoed")
        .withArgs(6, stakeholder3.address)
        .and.to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, 5, 2, "VETO");

      const profileAfterVeto = await vault.getAgentProfile(agent.address);
      expect(profileAfterVeto.reputation).to.equal(2);
      expect(profileAfterVeto.vetoCount).to.equal(1n);
      expect(await vault.currentWindow(agent.address)).to.equal(3540n);
      expect(await vault.currentLimit(agent.address)).to.equal(ethers.parseEther("0.03"));
    });
  });
});
