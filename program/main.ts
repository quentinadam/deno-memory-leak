console.log('Deno version', Deno.version.deno);

let timestamp = new Date();

const file = new URL('./hello.txt', import.meta.url).pathname;

while (true) {
  if (Date.now() >= timestamp.valueOf()) {
    const bytes = Deno.memoryUsage().rss;
    console.log(
      timestamp.toISOString(),
      Math.floor(bytes / (1024 * 1024) * 10) / 10,
    );
    timestamp = new Date(timestamp.valueOf() + 1000);
  }
  await Deno.readFileSync(file);
}