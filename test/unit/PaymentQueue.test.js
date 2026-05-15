const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const BASE_WINDOW = 3600n;
const REQUEST_AMOUNT = ethers.parseEther("0.005");
const BASE_LIMIT = ethers.parseEther("0.01");

describe("PaymentQueue", function () {
  async function deployAuthorizedVaultFixture() {
    const [stakeholder1, stakeholder2, stakeholder3, outsider, agent, recipient] =
      await ethers.getSigners();

    const AgentVault = await ethers.getContractFactory("AgentVault");
    const vault = await AgentVault.deploy(
      [stakeholder1.address, stakeholder2.address, stakeholder3.address],
      2
    );
    await vault.waitForDeployment();

    await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
    await vault.connect(stakeholder2).approveProposal(0);
    await stakeholder1.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("5") });

    return { vault, stakeholder1, stakeholder2, stakeholder3, outsider, agent, recipient };
  }

  async function deployAuthorizedUnfundedVaultFixture() {
    const [stakeholder1, stakeholder2, stakeholder3, outsider, agent, recipient] =
      await ethers.getSigners();

    const AgentVault = await ethers.getContractFactory("AgentVault");
    const vault = await AgentVault.deploy(
      [stakeholder1.address, stakeholder2.address, stakeholder3.address],
      2
    );
    await vault.waitForDeployment();

    await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
    await vault.connect(stakeholder2).approveProposal(0);

    return { vault, stakeholder1, stakeholder2, stakeholder3, outsider, agent, recipient };
  }

  async function submitRequest(vault, agent, recipient, amount = REQUEST_AMOUNT) {
    const intentHash = ethers.id("pay recipient");
    const tx = await vault.connect(agent).submit(recipient.address, amount, intentHash);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    return { intentHash, tx, receipt, submittedAt: BigInt(block.timestamp) };
  }

  describe("submit", function () {
    it("reverts when a non-agent submits", async function () {
      const { vault, outsider, recipient } = await loadFixture(deployAuthorizedVaultFixture);

      await expect(vault.connect(outsider).submit(recipient.address, REQUEST_AMOUNT, ethers.id("intent")))
        .to.be.revertedWithCustomError(vault, "NotAgent");
    });

    it("reverts when amount is zero", async function () {
      const { vault, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);

      await expect(vault.connect(agent).submit(recipient.address, 0, ethers.id("intent")))
        .to.be.revertedWithCustomError(vault, "AmountZero");
    });

    it("reverts when recipient is the zero address", async function () {
      const { vault, agent } = await loadFixture(deployAuthorizedVaultFixture);

      await expect(vault.connect(agent).submit(ethers.ZeroAddress, REQUEST_AMOUNT, ethers.id("intent")))
        .to.be.revertedWithCustomError(vault, "InvalidRecipient");
    });

    it("reverts when amount exceeds the current reputation limit", async function () {
      const { vault, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      const requested = ethers.parseEther("0.02");

      await expect(vault.connect(agent).submit(recipient.address, requested, ethers.id("intent")))
        .to.be.revertedWithCustomError(vault, "AmountExceedsLimit")
        .withArgs(requested, BASE_LIMIT);
    });

    it("stores request fields and increments requestCount", async function () {
      const { vault, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      const { intentHash, submittedAt } = await submitRequest(vault, agent, recipient);

      const request = await vault.getRequest(0);
      expect(await vault.requestCount()).to.equal(1n);
      expect(request.agent).to.equal(agent.address);
      expect(request.recipient).to.equal(recipient.address);
      expect(request.amount).to.equal(REQUEST_AMOUNT);
      expect(request.intentHash).to.equal(intentHash);
      expect(request.submittedAt).to.equal(submittedAt);
      expect(request.executableAt).to.equal(submittedAt + BASE_WINDOW);
      expect(request.status).to.equal(0n);
      expect(request.vetoedBy).to.equal(ethers.ZeroAddress);
    });

    it("emits PaymentRequested with the frozen executableAt", async function () {
      const { vault, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      const intentHash = ethers.id("intent");
      const tx = vault.connect(agent).submit(recipient.address, REQUEST_AMOUNT, intentHash);

      await expect(tx)
        .to.emit(vault, "PaymentRequested")
        .withArgs(0, agent.address, recipient.address, REQUEST_AMOUNT, intentHash, anyValue);
    });
  });

  describe("veto", function () {
    it("reverts when a non-stakeholder vetoes", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);

      await expect(vault.connect(outsider).veto(0))
        .to.be.revertedWithCustomError(vault, "NotStakeholder");
    });

    it("reverts when vetoing a nonexistent request", async function () {
      const { vault, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);

      await expect(vault.connect(stakeholder1).veto(999))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });

    it("vetoes a pending request and updates reputation", async function () {
      const { vault, agent, recipient, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);

      await expect(vault.connect(stakeholder1).veto(0))
        .to.emit(vault, "PaymentVetoed")
        .withArgs(0, stakeholder1.address)
        .and.to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, 0, -3, "VETO");

      const request = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(request.status).to.equal(2n);
      expect(request.vetoedBy).to.equal(stakeholder1.address);
      expect(profile.reputation).to.equal(-3);
      expect(profile.vetoCount).to.equal(1n);
    });

    it("reverts when vetoing an already vetoed request", async function () {
      const { vault, agent, recipient, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(0);

      await expect(vault.connect(stakeholder1).veto(0))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });

    it("allows veto after the execution window has elapsed if the request is still pending", async function () {
      const { vault, agent, recipient, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await time.increase(Number(BASE_WINDOW + 1n));

      await vault.connect(stakeholder1).veto(0);

      const request = await vault.getRequest(0);
      expect(request.status).to.equal(2n);
    });
  });

  describe("execute", function () {
    it("allows a non-stakeholder and non-agent caller to execute", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await time.increase(Number(BASE_WINDOW + 1n));

      await vault.connect(outsider).execute(0);

      const request = await vault.getRequest(0);
      expect(request.status).to.equal(1n);
    });

    it("reverts when executing a nonexistent request", async function () {
      const { vault, outsider } = await loadFixture(deployAuthorizedVaultFixture);

      await expect(vault.connect(outsider).execute(999))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });

    it("reverts when the execution window has not elapsed", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      const { submittedAt } = await submitRequest(vault, agent, recipient);

      await expect(vault.connect(outsider).execute(0))
        .to.be.revertedWithCustomError(vault, "WindowNotElapsed")
        .withArgs(anyValue, submittedAt + BASE_WINDOW);
    });

    it("reverts when the vault balance is insufficient at execution time", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedUnfundedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await time.increase(Number(BASE_WINDOW + 1n));

      await expect(vault.connect(outsider).execute(0))
        .to.be.revertedWithCustomError(vault, "InsufficientBalance")
        .withArgs(REQUEST_AMOUNT, 0);
    });

    it("executes a pending request to an EOA recipient", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await time.increase(Number(BASE_WINDOW + 1n));
      const vaultAddress = await vault.getAddress();
      const recipientBalanceBefore = await ethers.provider.getBalance(recipient.address);
      const vaultBalanceBefore = await ethers.provider.getBalance(vaultAddress);

      await expect(vault.connect(outsider).execute(0))
        .to.emit(vault, "PaymentExecuted")
        .withArgs(0)
        .and.to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, 0, 1, "SUCCESS");

      const request = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(request.status).to.equal(1n);
      expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientBalanceBefore + REQUEST_AMOUNT);
      expect(await ethers.provider.getBalance(vaultAddress)).to.equal(vaultBalanceBefore - REQUEST_AMOUNT);
      expect(profile.successCount).to.equal(1n);
      expect(profile.reputation).to.equal(1);
    });

    it("reverts when executing a vetoed request", async function () {
      const { vault, agent, recipient, outsider, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(0);
      await time.increase(Number(BASE_WINDOW + 1n));

      await expect(vault.connect(outsider).execute(0))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });

    it("reverts when executing the same request twice", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await time.increase(Number(BASE_WINDOW + 1n));
      await vault.connect(outsider).execute(0);

      await expect(vault.connect(outsider).execute(0))
        .to.be.revertedWithCustomError(vault, "RequestNotPending");
    });
  });

  describe("Failed state - reverting recipient", function () {
    it("marks request Failed without changing reputation when recipient reverts", async function () {
      const { vault, agent, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      const RevertingRecipient = await ethers.getContractFactory("RevertingRecipient");
      const revertingRecipient = await RevertingRecipient.deploy();
      await revertingRecipient.waitForDeployment();
      const recipientAddress = await revertingRecipient.getAddress();

      await vault.connect(agent).submit(recipientAddress, REQUEST_AMOUNT, ethers.id("revert"));
      await time.increase(Number(BASE_WINDOW + 1n));
      const vaultAddress = await vault.getAddress();
      const vaultBalanceBefore = await ethers.provider.getBalance(vaultAddress);
      const recipientBalanceBefore = await ethers.provider.getBalance(recipientAddress);

      const tx = await vault.connect(outsider).execute(0);
      await expect(tx).to.emit(vault, "PaymentFailed").withArgs(0, anyValue);

      const receipt = await tx.wait();
      const reputationChangedTopic = vault.interface.getEvent("ReputationChanged").topicHash;
      expect(receipt.logs.some((log) => log.topics[0] === reputationChangedTopic)).to.equal(false);

      const request = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(request.status).to.equal(3n);
      expect(await ethers.provider.getBalance(recipientAddress)).to.equal(recipientBalanceBefore);
      expect(await ethers.provider.getBalance(vaultAddress)).to.equal(vaultBalanceBefore);
      expect(profile.reputation).to.equal(0);
      expect(profile.successCount).to.equal(0n);
      expect(profile.vetoCount).to.equal(0n);
    });
  });

  describe("Reentrancy protection", function () {
    it("blocks recursive execute while allowing the outer execution to succeed", async function () {
      const { vault, agent, outsider } = await loadFixture(deployAuthorizedVaultFixture);
      const MaliciousRecipient = await ethers.getContractFactory("MaliciousRecipient");
      const maliciousRecipient = await MaliciousRecipient.deploy();
      await maliciousRecipient.waitForDeployment();
      const maliciousAddress = await maliciousRecipient.getAddress();

      await vault.connect(agent).submit(maliciousAddress, REQUEST_AMOUNT, ethers.id("malicious"));
      await maliciousRecipient.setTarget(await vault.getAddress(), 0);
      await time.increase(Number(BASE_WINDOW + 1n));

      const tx = await vault.connect(outsider).execute(0);
      await expect(tx).to.emit(vault, "PaymentExecuted").withArgs(0);

      const receipt = await tx.wait();
      const paymentExecutedTopic = vault.interface.getEvent("PaymentExecuted").topicHash;
      const paymentExecutedLogs = receipt.logs.filter((log) => log.topics[0] === paymentExecutedTopic);
      const request = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(await maliciousRecipient.attackedOnce()).to.equal(true);
      expect(request.status).to.equal(1n);
      expect(paymentExecutedLogs).to.have.lengthOf(1);
      expect(profile.reputation).to.equal(1);
    });
  });

  describe("Frozen executableAt", function () {
    it("does not change a pending request executableAt after later reputation changes", async function () {
      const { vault, agent, recipient, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);
      const first = await submitRequest(vault, agent, recipient);
      const firstBefore = await vault.getRequest(0);

      for (let i = 0; i < 4; i++) {
        await submitRequest(vault, agent, recipient);
        await vault.connect(stakeholder1).veto(i + 1);
      }

      const firstAfter = await vault.getRequest(0);
      const profile = await vault.getAgentProfile(agent.address);
      expect(firstBefore.executableAt).to.equal(first.submittedAt + BASE_WINDOW);
      expect(firstAfter.executableAt).to.equal(firstBefore.executableAt);
      expect(profile.reputation).to.equal(-10);
    });
  });

  describe("Reputation clamping", function () {
    it("clamps reputation at the minimum after repeated vetoes", async function () {
      const { vault, agent, recipient, stakeholder1 } = await loadFixture(deployAuthorizedVaultFixture);

      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(0);
      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(1);
      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(2);
      await submitRequest(vault, agent, recipient);
      await expect(vault.connect(stakeholder1).veto(3))
        .to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, -9, -10, "VETO");

      await submitRequest(vault, agent, recipient);
      await expect(vault.connect(stakeholder1).veto(4))
        .to.emit(vault, "ReputationChanged")
        .withArgs(agent.address, -10, -10, "VETO");

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.reputation).to.equal(-10);
    });

    it("clamps reputation at the maximum after repeated successful executions", async function () {
      const { vault, agent, recipient, outsider } = await loadFixture(deployAuthorizedVaultFixture);

      for (let i = 0; i < 101; i++) {
        await submitRequest(vault, agent, recipient, ethers.parseEther("0.001"));
        const request = await vault.getRequest(i);
        await time.increaseTo(request.executableAt);
        await vault.connect(outsider).execute(i);
      }

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.reputation).to.equal(100);
      expect(profile.successCount).to.equal(101n);
    });
  });
});
