import hre from "hardhat";

async function main() {
  console.log("Deploying ElementalDuel contract...");

  const elementalDuel = await hre.viem.deployContract("ElementalDuel");

  console.log(`ElementalDuel deployed to: ${elementalDuel.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 