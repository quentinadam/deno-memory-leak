# deno-memory-leak

The following very simple program will ostensibly (at a rate of ~1MB/second) leak memory in Deno (**only on Deno versions >= 1.31.0**):
```ts
const file = new URL('./hello.txt', import.meta.url).pathname;
while (true) {
  Deno.readFileSync(file);
}
```

Here is a slightly longer version of the program that will output the memory usage every second :

```ts
console.log('Deno version', Deno.version.deno);

const file = new URL('./hello.txt', import.meta.url).pathname;

let timestamp = new Date();

while (true) {
  if (Date.now() >= timestamp.valueOf()) {
    const bytes = Deno.memoryUsage().rss;
    console.log(timestamp.toISOString(), Math.floor(bytes / (1024 * 1024) * 10) / 10);
    timestamp = new Date(timestamp.valueOf() + 1000);
  }
  Deno.readFileSync(file);
}
```

### Running the program inside a docker container

Go the the `program` directory and run the following command :

```
docker run --rm -it --name program $(docker build -q .)
```

The program will output the timestamp and the memory usage (in MB) every second:
```
2023-03-22T21:56:48.865Z 44.9
2023-03-22T21:56:49.865Z 54.3
2023-03-22T21:56:50.865Z 54.9
2023-03-22T21:56:51.865Z 55.7
...
```

### Running the monitoring container

Additionally this repository comes with a monitoring program that connects to the Docker deamon to read memory usage stats and uploads them to an InfluxDB bucket.

Go the the `monitoring` directory and run the following command :

```
docker run --rm -it --name monitoring \
  --volume /var/run/docker.sock:/var/run/docker.sock \
  --env INFLUX_HOST=[https://eu-central-1-1.aws.cloud2.influxdata.com] \
  --env INFLUX_ORG=[ORGANISATION] \
  --env INFLUX_BUCKET=[BUCKET] \
  --env INFLUX_TOKEN=[TOKEN] \
  $(docker build -q .)
```

### Running both containers with Docker compose

Additionally this repository comes with a `docker-compose.yml` that can run both containers.

Add an `.env` file at the root of the repository with the influx configuration:
```
INFLUX_HOST=[https://eu-central-1-1.aws.cloud2.influxdata.com]
INFLUX_ORG=[ORGANISATION]
INFLUX_BUCKET=[BUCKET]
INFLUX_TOKEN=[TOKEN]
```

Build the containers:
```
docker compose build
```

Run the containers:
```
docker compose up
```





