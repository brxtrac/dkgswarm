import { startStack } from "./stack.mjs";

const stack = await startStack({ port: 43171 });
console.log(`Local browser fixture ${stack.webUrl}`);
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  await stack.close();
  process.exit(0);
});
