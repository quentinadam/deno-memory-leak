FROM denoland/deno:alpine-1.30.3

WORKDIR /app

COPY deps.ts .

RUN deno cache deps.ts

ADD . .

CMD ["deno", "task", "run"]