const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

export async function run() {
  let failures = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(error.stack || error);
    }
  }

  if (failures) {
    process.exitCode = 1;
    throw new Error(`${failures} test(s) failed`);
  }

  console.log(`Passed ${tests.length} test(s)`);
}
