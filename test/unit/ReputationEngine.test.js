const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const REQUEST_AMOUNT = ethers.parseEther("0.005");

describe("ReputationEngine", function () {
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

  async function submitRequest(vault, agent, recipient) {
    await vault.connect(agent).submit(recipient.address, REQUEST_AMOUNT, ethers.id("intent"));
  }

  describe("contract-side reputation state", function () {
    it("starts a new agent at reputation 0", async function () {
      const { vault, agent } = await loadFixture(deployAuthorizedVaultFixture);

      const profile = await vault.getAgentProfile(agent.address);

      expect(profile.reputation).to.equal(0);
    });

    it("sets reputation to -3 after one veto", async function () {
      const { vault, stakeholder1, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);

      await vault.connect(stakeholder1).veto(0);

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.reputation).to.equal(-3);
    });

    it("increments reputation by 1 after one success", async function () {
      const { vault, outsider, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      const request = await vault.getRequest(0);
      await time.increaseTo(request.executableAt);

      await vault.connect(outsider).execute(0);

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.reputation).to.equal(1);
    });

    it("updates currentWindow after reputation changes", async function () {
      const { vault, stakeholder1, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      await vault.connect(stakeholder1).veto(0);

      expect(await vault.currentWindow(agent.address)).to.equal(3690n);
    });

    it("updates currentLimit after reputation changes", async function () {
      const { vault, outsider, agent, recipient } = await loadFixture(deployAuthorizedVaultFixture);
      await submitRequest(vault, agent, recipient);
      const request = await vault.getRequest(0);
      await time.increaseTo(request.executableAt);
      await vault.connect(outsider).execute(0);

      expect(await vault.currentLimit(agent.address)).to.equal(ethers.parseEther("0.02"));
    });

    it("does not change reputation when execution fails", async function () {
      const { vault, outsider, agent } = await loadFixture(deployAuthorizedVaultFixture);
      const RevertingRecipient = await ethers.getContractFactory("RevertingRecipient");
      const revertingRecipient = await RevertingRecipient.deploy();
      await revertingRecipient.waitForDeployment();

      await vault.connect(agent).submit(await revertingRecipient.getAddress(), REQUEST_AMOUNT, ethers.id("fail"));
      const request = await vault.getRequest(0);
      await time.increaseTo(request.executableAt);
      await vault.connect(outsider).execute(0);

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.reputation).to.equal(0);
    });
  });
});
