const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

describe("ReputationMath", function () {
  async function deployHarnessFixture() {
    const ReputationMathHarness = await ethers.getContractFactory("ReputationMathHarness");
    const harness = await ReputationMathHarness.deploy();
    await harness.waitForDeployment();

    return { harness };
  }

  describe("computeWindow", function () {
    it("returns BASE_WINDOW when reputation is 0", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(0);

      expect(actual).to.equal(3600n);
    });

    it("reduces the window by one slope unit when reputation is 1", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(1);

      expect(actual).to.equal(3570n);
    });

    it("reduces the window linearly for reputation 50", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(50);

      expect(actual).to.equal(2100n);
    });

    it("keeps reputation 100 above the minimum window", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(100);

      expect(actual).to.equal(600n);
    });

    it("returns MIN_WINDOW when reputation reaches the lower-bound threshold", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(110);

      expect(actual).to.equal(300n);
    });

    it("returns MIN_WINDOW for reputation above the configured maximum", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(200);

      expect(actual).to.equal(300n);
    });

    it("increases the window by one slope unit when reputation is -1", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(-1);

      expect(actual).to.equal(3630n);
    });

    it("increases the window linearly for reputation -10", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(-10);

      expect(actual).to.equal(3900n);
    });

    it("increases the window linearly below the configured minimum reputation", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.window(-100);

      expect(actual).to.equal(6600n);
    });
  });

  describe("computeLimit", function () {
    it("returns BASE_LIMIT when reputation is 0", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(0);

      expect(actual).to.equal(ethers.parseEther("0.01"));
    });

    it("increases the limit by one slope unit when reputation is 1", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(1);

      expect(actual).to.equal(ethers.parseEther("0.02"));
    });

    it("increases the limit linearly for reputation 50", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(50);

      expect(actual).to.equal(ethers.parseEther("0.51"));
    });

    it("returns MAX_LIMIT when reputation 99 reaches exactly the cap", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(99);

      expect(actual).to.equal(ethers.parseEther("1"));
    });

    it("caps the limit at MAX_LIMIT when reputation is 100", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(100);

      expect(actual).to.equal(ethers.parseEther("1"));
    });

    it("caps the limit at MAX_LIMIT above the configured maximum reputation", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(150);

      expect(actual).to.equal(ethers.parseEther("1"));
    });

    it("returns half BASE_LIMIT when reputation is -1", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(-1);

      expect(actual).to.equal(ethers.parseEther("0.005"));
    });

    it("returns half BASE_LIMIT when reputation is -10", async function () {
      const { harness } = await loadFixture(deployHarnessFixture);

      const actual = await harness.limit(-10);

      expect(actual).to.equal(ethers.parseEther("0.005"));
    });
  });
});
