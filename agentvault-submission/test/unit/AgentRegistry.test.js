const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgentRegistry", function () {
  async function deployVaultFixture() {
    const [stakeholder1, stakeholder2, stakeholder3, outsider, agent, recipient, owner] =
      await ethers.getSigners();

    const AgentVault = await ethers.getContractFactory("AgentVault");
    const vault = await AgentVault.deploy(
      [stakeholder1.address, stakeholder2.address, stakeholder3.address],
      2
    );
    await vault.waitForDeployment();

    return {
      vault,
      owner,
      stakeholder1,
      stakeholder2,
      stakeholder3,
      outsider,
      agent,
      recipient,
    };
  }

  async function authorizeAgent(vault, stakeholder1, stakeholder2, agent) {
    await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
    await vault.connect(stakeholder2).approveProposal(0);
  }

  describe("AuthorizeAgent flow", function () {
    it("authorizes an agent and sets authorizedAt", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);

      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);
      const profile = await vault.getAgentProfile(agent.address);

      expect(profile[0]).to.equal(true);
      expect(profile[2]).to.be.greaterThan(0n);
    });

    it("starts an authorized agent with reputation 0", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);

      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);
      const profile = await vault.getAgentProfile(agent.address);

      expect(profile[1]).to.equal(0);
    });

    it("reverts when proposing authorization for an already authorized agent", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);

      await expect(vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address))
        .to.be.revertedWithCustomError(vault, "AgentAlreadyAuthorized");
    });
  });

  describe("RevokeAgent flow", function () {
    it("revokes an authorized agent", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);

      await vault.connect(stakeholder1).proposeRevokeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(1);
      const profile = await vault.getAgentProfile(agent.address);

      expect(profile[0]).to.equal(false);
    });

    it("keeps reputation unchanged after revoke", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);

      await vault.connect(stakeholder1).proposeRevokeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(1);
      const profile = await vault.getAgentProfile(agent.address);

      expect(profile[1]).to.equal(0);
    });

    it("reverts when proposing revoke for an unauthorized agent", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(stakeholder1).proposeRevokeAgent(agent.address))
        .to.be.revertedWithCustomError(vault, "AgentNotAuthorized");
    });
  });

  describe("Re-authorize after revoke", function () {
    it("re-authorizes after revoke and updates authorizedAt", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);
      const firstProfile = await vault.getAgentProfile(agent.address);

      await vault.connect(stakeholder1).proposeRevokeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(1);
      await time.increase(10);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(2);

      const secondProfile = await vault.getAgentProfile(agent.address);
      expect(secondProfile[0]).to.equal(true);
      expect(secondProfile[2]).to.be.greaterThan(firstProfile[2]);
    });

    it("preserves nonzero reputation across re-authorization", async function () {
      const { vault, stakeholder1, stakeholder2, agent, recipient } = await loadFixture(deployVaultFixture);
      await authorizeAgent(vault, stakeholder1, stakeholder2, agent);
      await vault.connect(agent).submit(recipient.address, ethers.parseEther("0.005"), ethers.id("veto-before-revoke"));
      await vault.connect(stakeholder1).veto(0);

      await vault.connect(stakeholder1).proposeRevokeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(1);
      await time.increase(10);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(2);

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile.authorized).to.equal(true);
      expect(profile.reputation).to.equal(-3);
      expect(profile.vetoCount).to.equal(1n);
      expect(profile.authorizedAt).to.be.greaterThan(0n);
    });
  });
});
