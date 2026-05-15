const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

describe("StakeholderManager", function () {
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

  describe("propose by access control", function () {
    it("reverts when a non-stakeholder proposes agent authorization", async function () {
      const { vault, outsider, agent } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(outsider).proposeAuthorizeAgent(agent.address))
        .to.be.revertedWithCustomError(vault, "NotStakeholder");
    });

    it("reverts when a non-stakeholder approves a proposal", async function () {
      const { vault, stakeholder1, outsider, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      await expect(vault.connect(outsider).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "NotStakeholder");
    });
  });

  describe("proposal creation", function () {
    it("increments proposalCount when a stakeholder proposes agent authorization", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);

      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      expect(await vault.proposalCount()).to.equal(1n);
    });

    it("stores proposer, target, status, and initial approval count", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);

      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
      const proposal = await vault.getProposal(0);

      expect(proposal[1]).to.equal(agent.address);
      expect(proposal[2]).to.equal(stakeholder1.address);
      expect(proposal[5]).to.equal(0n);
      expect(proposal[6]).to.equal(1n);
    });

    it("records the proposer as having approved", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);

      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      expect(await vault.hasApproved(0, stakeholder1.address)).to.equal(true);
    });

    it("does not record another stakeholder as having approved", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);

      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      expect(await vault.hasApproved(0, stakeholder2.address)).to.equal(false);
    });

    it("emits ProposalCreated and ProposalApproved for the proposer's automatic approval", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address))
        .to.emit(vault, "ProposalCreated")
        .withArgs(0, 0, agent.address, stakeholder1.address)
        .and.to.emit(vault, "ProposalApproved")
        .withArgs(0, stakeholder1.address, 1);
    });
  });

  describe("approveProposal", function () {
    it("auto-executes when approvals reach the threshold", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      await expect(vault.connect(stakeholder2).approveProposal(0))
        .to.emit(vault, "ProposalApproved")
        .withArgs(0, stakeholder2.address, 2)
        .and.to.emit(vault, "AgentAuthorized")
        .withArgs(agent.address, 0)
        .and.to.emit(vault, "ProposalExecuted")
        .withArgs(0);

      const profile = await vault.getAgentProfile(agent.address);
      const proposal = await vault.getProposal(0);
      expect(profile[0]).to.equal(true);
      expect(proposal[5]).to.equal(1n);
    });

    it("reverts when a stakeholder approves the same proposal twice", async function () {
      const { vault, stakeholder1, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      await expect(vault.connect(stakeholder1).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "ProposalAlreadyApproved");
    });

    it("reverts when a non-stakeholder approves a proposal", async function () {
      const { vault, stakeholder1, outsider, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);

      await expect(vault.connect(outsider).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "NotStakeholder");
    });

    it("reverts when approving a proposal that does not exist", async function () {
      const { vault, stakeholder2 } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(stakeholder2).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "ProposalNotFound");
    });

    it("reverts when approving an already executed proposal", async function () {
      const { vault, stakeholder1, stakeholder2, stakeholder3, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
      await vault.connect(stakeholder2).approveProposal(0);

      await expect(vault.connect(stakeholder3).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "ProposalNotPending");
    });
  });

  describe("proposal expiry", function () {
    it("reverts with ProposalExpired when approval happens after the TTL", async function () {
      const { vault, stakeholder1, stakeholder2, agent } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address);
      await time.increase(7 * 24 * 60 * 60 + 1);

      await expect(vault.connect(stakeholder2).approveProposal(0))
        .to.be.revertedWithCustomError(vault, "ProposalExpired");
    });
  });

  describe("threshold == 1 case", function () {
    it("executes the proposal in the same transaction as creation", async function () {
      const { stakeholder1, agent } = await loadFixture(deployVaultFixture);
      const AgentVault = await ethers.getContractFactory("AgentVault");
      const vault = await AgentVault.deploy([stakeholder1.address], 1);
      await vault.waitForDeployment();

      await expect(vault.connect(stakeholder1).proposeAuthorizeAgent(agent.address))
        .to.emit(vault, "ProposalCreated")
        .withArgs(0, 0, agent.address, stakeholder1.address)
        .and.to.emit(vault, "ProposalApproved")
        .withArgs(0, stakeholder1.address, 1)
        .and.to.emit(vault, "AgentAuthorized")
        .withArgs(agent.address, 0)
        .and.to.emit(vault, "ProposalExecuted")
        .withArgs(0);

      const profile = await vault.getAgentProfile(agent.address);
      expect(profile[0]).to.equal(true);
    });
  });

  describe("AddStakeholder / RemoveStakeholder", function () {
    it("adds a new stakeholder after threshold approval", async function () {
      const { vault, stakeholder1, stakeholder2, outsider } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeAddStakeholder(outsider.address);
      await vault.connect(stakeholder2).approveProposal(0);

      expect(await vault.isStakeholder(outsider.address)).to.equal(true);
      expect(await vault.getStakeholders()).to.have.lengthOf(4);
    });

    it("removes a stakeholder after threshold approval", async function () {
      const { vault, stakeholder1, stakeholder2, stakeholder3 } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeRemoveStakeholder(stakeholder3.address);
      await vault.connect(stakeholder2).approveProposal(0);

      expect(await vault.isStakeholder(stakeholder3.address)).to.equal(false);
      expect(await vault.getStakeholders()).to.have.lengthOf(2);
    });

    it("allows removal proposal creation but reverts execution below the threshold", async function () {
      const { vault, stakeholder1, stakeholder2, stakeholder3 } = await loadFixture(deployVaultFixture);
      await vault.connect(stakeholder1).proposeRemoveStakeholder(stakeholder3.address);
      await vault.connect(stakeholder2).approveProposal(0);

      await vault.connect(stakeholder1).proposeRemoveStakeholder(stakeholder1.address);

      await expect(vault.connect(stakeholder2).approveProposal(1))
        .to.be.revertedWithCustomError(vault, "WouldDropBelowThreshold");
    });

    it("reverts when proposing to add an existing stakeholder", async function () {
      const { vault, stakeholder1, stakeholder2 } = await loadFixture(deployVaultFixture);

      await expect(vault.connect(stakeholder1).proposeAddStakeholder(stakeholder2.address))
        .to.be.revertedWithCustomError(vault, "AlreadyStakeholder");
    });
  });
});
