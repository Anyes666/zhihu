import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const ignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");

test("deployment image copies only explicit runtime paths, never the whole workspace", () => {
  const copies = dockerfile.split(/\r?\n/).filter(line => /^COPY /i.test(line));
  assert.deepEqual(copies, [
    "COPY package.json server.mjs ./",
    "COPY lib/ ./lib/",
    "COPY data/characters.mjs ./data/",
    "COPY data/letters/ ./data/letters/",
    "COPY data/demo/ ./data/demo/",
    "COPY public/ ./public/",
  ]);
});

test("deployment build context denies files by default and never includes runtime secrets", () => {
  const rules = ignore.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
  assert.equal(rules[0], "**");
  for (const denied of ["**/.env", "**/.env.*", "**/*.pem", "**/*.key", "data/cache/", "data/budget/"]) {
    assert.ok(rules.includes(denied), `missing final exclusion: ${denied}`);
    assert.ok(rules.indexOf(denied) > rules.findLastIndex(s => s.startsWith("!")));
  }
});

test("deployment keeps Node 24, the app entrypoint, and a matching health port", () => {
  assert.match(dockerfile, /^FROM node:24-alpine$/m);
  assert.match(dockerfile, /^ENV PORT=8080 HOST=0\.0\.0\.0$/m);
  assert.match(dockerfile, /^EXPOSE 8080$/m);
  assert.match(dockerfile, /http:\/\/127\.0\.0\.1:8080\/api\/health/);
  assert.match(dockerfile, /^CMD \["node", "server\.mjs"\]$/m);
});


test("local Sealos access files are excluded from Git publication", () => {
  const ignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(ignore, /^kubeconfig\*$/m);
  assert.match(ignore, /^\*\*\/kubeconfig\*$/m);
});


test("CI does not override the providers owned by isolated mock tests", () => {
  const workflow = readFileSync(new URL("../.github/workflows/verify-deployment.yml", import.meta.url), "utf8");
  const jobConfiguration = workflow.split("    steps:")[0];
  assert.doesNotMatch(jobConfiguration, /LLM_PROVIDER|ZHIHU_KNOWLEDGE_ENABLED/);
});
