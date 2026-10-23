"use strict";
const test = require("node:test");
const assert = require("node:assert");
const L = require("../src/logic.js");

const FAKE = "REDACT" + "ED-TEST" + "-VALUE-123";

test("tokenizer handles quotes and line continuations", () => {
  const tokens = L.tokenizeCurl("curl 'https://api.example.com/a b' \\\n  -H 'X-Test: one two' -d \"x=1\"");
  assert.ok(tokens.includes("https://api.example.com/a b"));
  assert.ok(tokens.includes("X-Test: one two"));
  assert.ok(tokens.includes("x=1"));
  assert.strictEqual(tokens[0], "curl");
});

test("parser reads method, headers, data and url", () => {
  const req = L.parseCurl('curl -X PUT https://api.example.com/items/3 -H "Content-Type: application/json" -d \'{"a":1}\'');
  assert.strictEqual(req.method, "PUT");
  assert.strictEqual(req.url, "https://api.example.com/items/3");
  assert.strictEqual(req.headers[0].name, "Content-Type");
  assert.strictEqual(req.data, '{"a":1}');
  const post = L.parseCurl("curl https://api.example.com/x -d a=1");
  assert.strictEqual(post.method, "POST"); // data implies POST
});

test("parser handles form fields, cookies and basic auth user", () => {
  const cmd = "curl https://api.example.com/upload -F name=report -F file=@a.csv -b session=abc -u user:pass";
  const req = L.parseCurl(cmd);
  assert.strictEqual(req.form.length, 2);
  assert.strictEqual(req.form[0].name, "name");
  assert.ok(req.headers.some(h => h.name === "Cookie"));
  assert.strictEqual(req.user, "user:pass");
});

test("--json sets method and JSON headers", () => {
  const req = L.parseCurl("curl https://api.example.com/x --json '{\"a\":2}'");
  assert.strictEqual(req.method, "POST");
  assert.ok(req.headers.some(h => h.name === "Content-Type" && h.value === "application/json"));
  assert.ok(req.headers.some(h => h.name === "Accept"));
});

test("secrets are extracted to env placeholders in every target", () => {
  const cmd = 'curl https://api.example.com/me -H "Authorization: Bearer ' + FAKE + '" -H "X-Api-Key: ' + FAKE + '"';
  const all = L.convertAll(cmd);
  assert.ok(all.fetch.includes("process.env.AUTH_TOKEN"), all.fetch);
  assert.ok(all.fetch.includes("process.env.API_KEY"), all.fetch);
  assert.ok(all.python.includes('os.environ["AUTH_TOKEN"]'), all.python);
  assert.ok(all.go.includes('os.Getenv("AUTH_TOKEN")'), all.go);
  assert.ok(all.php.includes('getenv("AUTH_TOKEN")'), all.php);
  const everything = all.fetch + all.axios + all.python + all.go + all.php;
  assert.ok(!everything.includes(FAKE), "raw secret leaked into generated code");
});

test("code generation per target has the right shape", () => {
  const cmd = 'curl -X POST https://api.example.com/items -H "Content-Type: application/json" -d \'{"name":"widget"}\'';
  const all = L.convertAll(cmd);
  assert.ok(all.fetch.includes('fetch("https://api.example.com/items"'));
  assert.ok(all.fetch.includes('"POST"'));
  assert.ok(all.axios.includes('require("axios")'));
  assert.ok(all.python.includes("requests.post"));
  assert.ok(all.go.includes("http.NewRequest"));
  assert.ok(all.php.includes("curl_init"));
  assert.ok(all.php.includes("CURLOPT_POST"));
});

test("unsupported flags produce warnings instead of silent drops", () => {
  const req = L.parseCurl("curl https://api.example.com/x --cert client.pem -s");
  assert.ok(req.unsupported.includes("--cert"));
  assert.ok(req.warnings.some(w => w.includes("--cert")));
  assert.ok(req.warnings.some(w => w.includes("-s")));
});

test("fetch code converts back to cURL", () => {
  const code = 'await fetch("https://api.example.com/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\\"a\\":1}" });';
  const out = L.fetchToCurl(code);
  assert.ok(out.code.startsWith("curl"));
  assert.ok(out.code.includes("-X POST"));
  assert.ok(out.code.includes("Content-Type: application/json"));
  const bad = L.fetchToCurl("console.log(1)");
  assert.ok(bad.error);
});

test("python requests code converts back to cURL", () => {
  const code = 'import requests\nurl = "https://api.example.com/x"\nheaders = {"Accept": "application/json"}\nresponse = requests.get(url, headers=headers)';
  const out = L.pythonToCurl(code);
  assert.ok(out.code.includes("https://api.example.com/x"));
  assert.ok(out.code.includes("Accept: application/json"));
});
