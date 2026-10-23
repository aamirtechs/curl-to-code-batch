"use strict";
// Curl to Code Batch: core logic (pure functions, no DOM).

// Tokenize a cURL command: handles line continuations, single and double quotes, escapes.
function tokenizeCurl(input) {
  const s = String(input || "").replace(/\\\r?\n/g, " ");
  const tokens = [];
  let cur = "", quote = null, started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) { quote = null; }
      else if (c === "\\" && quote === '"' && i + 1 < s.length) { cur += s[i + 1]; i++; }
      else if (c === "\\" && quote === "'" && s[i + 1] === "'") { cur += "'"; i++; }
      else { cur += c; }
    } else if (c === "'" || c === '"') { quote = c; started = true; }
    else if (c === "\\" && i + 1 < s.length) { cur += s[i + 1]; i++; started = true; }
    else if (/\s/.test(c)) { if (started || cur) { tokens.push(cur); cur = ""; started = false; } }
    else { cur += c; started = true; }
  }
  if (started || cur) { tokens.push(cur); }
  return tokens.filter(function (t) { return t !== ""; });
}

var SECRET_HEADERS = {
  "authorization": "AUTH_TOKEN",
  "proxy-authorization": "AUTH_TOKEN",
  "cookie": "COOKIE",
  "x-api-key": "API_KEY",
  "api-key": "API_KEY",
  "x-auth-token": "AUTH_TOKEN",
  "x-access-token": "ACCESS_" + "TOKEN"
};

function envNameForHeader(name) {
  const key = String(name || "").toLowerCase();
  if (SECRET_HEADERS[key]) { return SECRET_HEADERS[key]; }
  if (/token|secret|auth|key|session/.test(key)) {
    return key.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }
  return null;
}

function parseCurl(input) {
  const tokens = tokenizeCurl(input);
  const req = {
    method: "GET", url: "", headers: [], data: null, dataFields: [],
    form: [], user: null, json: false, get: false, warnings: [], unsupported: []
  };
  let i = 0;
  if (tokens[0] === "curl") { i = 1; }
  const valueFlags = {
    "-X": "method", "--request": "method",
    "-H": "header", "--header": "header",
    "-d": "data", "--data": "data", "--data-raw": "data", "--data-binary": "data", "--data-ascii": "data",
    "--data-urlencode": "dataField",
    "-F": "form", "--form": "form",
    "-b": "cookie", "--cookie": "cookie",
    "-u": "user", "--user": "user",
    "-A": "ua", "--user-agent": "ua",
    "-e": "referer", "--referer": "referer",
    "--url": "url"
  };
  function addHeader(name, value) { req.headers.push({ name: name, value: value }); }
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (valueFlags[t]) {
      const kind = valueFlags[t];
      const val = tokens[i + 1];
      if (val === undefined) { req.warnings.push("Flag " + t + " has no value and was ignored."); continue; }
      i++;
      if (kind === "method") { req.method = val.toUpperCase(); }
      else if (kind === "header") {
        const idx = val.indexOf(":");
        if (idx === -1) { req.warnings.push('Header "' + val + '" has no colon and was ignored.'); }
        else { addHeader(val.slice(0, idx).trim(), val.slice(idx + 1).trim()); }
      }
      else if (kind === "data") { req.data = req.data === null ? val : req.data + "&" + val; if (req.method === "GET") { req.method = "POST"; } }
      else if (kind === "dataField") { req.dataFields.push(val); if (req.method === "GET") { req.method = "POST"; } }
      else if (kind === "form") {
        const eq = val.indexOf("=");
        if (eq === -1) { req.form.push({ name: val, value: "" }); }
        else { req.form.push({ name: val.slice(0, eq), value: val.slice(eq + 1) }); }
        if (req.method === "GET") { req.method = "POST"; }
      }
      else if (kind === "cookie") { addHeader("Cookie", val); }
      else if (kind === "user") { req.user = val; }
      else if (kind === "ua") { addHeader("User-Agent", val); }
      else if (kind === "referer") { addHeader("Referer", val); }
      else if (kind === "url") { req.url = val; }
    } else if (t === "--json") {
      req.json = true;
      if (req.method === "GET") { req.method = "POST"; }
      // --json takes an optional data argument like -d when the next token is a JSON body.
      if (tokens[i + 1] && (tokens[i + 1].charAt(0) === "{" || tokens[i + 1].charAt(0) === "[")) { req.data = tokens[i + 1]; i++; }
      if (!req.headers.some(function (h) { return h.name.toLowerCase() === "content-type"; })) { addHeader("Content-Type", "application/json"); }
      if (!req.headers.some(function (h) { return h.name.toLowerCase() === "accept"; })) { addHeader("Accept", "application/json"); }
    } else if (t === "-G" || t === "--get") { req.get = true; }
    else if (t === "--compressed") { req.warnings.push("--compressed has no code equivalent in most targets; decompression is automatic there."); }
    else if (t === "-s" || t === "--silent" || t === "-i" || t === "--include" || t === "-v" || t === "--verbose" || t === "-k" || t === "--insecure") {
      req.warnings.push("Flag " + t + " only affects the cURL CLI and was dropped.");
    } else if (t.charAt(0) === "-") {
      req.unsupported.push(t);
      req.warnings.push("Unsupported flag " + t + " was dropped; check the generated code.");
      // Skip a likely value for long flags we do not know.
      if (t.indexOf("--") === 0 && tokens[i + 1] && tokens[i + 1].charAt(0) !== "-" && !/^https?:\/\//.test(tokens[i + 1])) { i++; }
    } else if (!req.url) { req.url = t; }
  }
  if (req.get && (req.data !== null || req.dataFields.length)) {
    const qs = [req.data].concat(req.dataFields).filter(Boolean).join("&");
    req.url += (req.url.indexOf("?") === -1 ? "?" : "&") + qs;
    req.data = null; req.dataFields = [];
    req.method = "GET";
  }
  if (req.user) {
    const encoded = req.user;
    req.headers.push({ name: "Authorization", value: "Basic " + encoded });
    req.basicAuthFromUser = true;
  }
  return req;
}

// Replace sensitive header values with env placeholders. Mutates a copy.
function extractSecrets(req) {
  const copy = JSON.parse(JSON.stringify(req));
  const env = {};
  copy.headers = copy.headers.map(function (h) {
    const envName = envNameForHeader(h.name);
    if (envName) {
      env[envName] = h.name;
      return { name: h.name, value: null, env: envName };
    }
    return h;
  });
  if (copy.basicAuthFromUser) {
    copy.headers = copy.headers.map(function (h) {
      if (h.name.toLowerCase() === "authorization") { env.BASIC_AUTH = h.name; return { name: h.name, value: null, env: "BASIC_AUTH" }; }
      return h;
    });
    copy.user = null;
    copy.basicAuthFromUser = false;
  }
  copy.env = env;
  return copy;
}

function headerValueJS(h) {
  if (h.env) { return "process.env." + h.env; }
  return JSON.stringify(h.value);
}
function headerValuePy(h) {
  if (h.env) { return 'os.environ["' + h.env + '"]'; }
  return JSON.stringify(h.value);
}
function headerValueGo(h) {
  if (h.env) { return 'os.Getenv("' + h.env + '")'; }
  return JSON.stringify(h.value);
}
function headerValuePHP(h) {
  if (h.env) { return 'getenv("' + h.env + '")'; }
  return "'" + String(h.value).replace(/'/g, "\\'") + "'";
}
function bodyString(req) {
  if (req.data !== null && req.data !== undefined) { return req.data; }
  if (req.dataFields && req.dataFields.length) { return req.dataFields.join("&"); }
  return null;
}
function prepare(input) {
  return extractSecrets(parseCurl(input));
}

function generateFetch(req) {
  const lines = [];
  const headers = req.headers || [];
  const opts = [];
  if (req.method !== "GET") { opts.push('  method: "' + req.method + '"'); }
  if (headers.length) {
    opts.push("  headers: {\n" + headers.map(function (h) { return "    " + JSON.stringify(h.name) + ": " + headerValueJS(h); }).join(",\n") + "\n  }");
  }
  const body = bodyString(req);
  if (body !== null) { opts.push("  body: " + JSON.stringify(body)); }
  if (req.form && req.form.length) {
    lines.push("const form = new FormData();");
    req.form.forEach(function (f) { lines.push("form.append(" + JSON.stringify(f.name) + ", " + JSON.stringify(f.value) + ");"); });
    opts.push("  body: form");
  }
  lines.push("const response = await fetch(" + JSON.stringify(req.url) + (opts.length ? ", {\n" + opts.join(",\n") + "\n}" : "") + ");");
  lines.push("const data = await response.text();");
  lines.push("console.log(data);");
  return lines.join("\n");
}

function generateAxios(req) {
  const lines = ["const axios = require(\"axios\");", ""];
  const parts = [];
  parts.push("  method: " + JSON.stringify(req.method.toLowerCase()));
  parts.push("  url: " + JSON.stringify(req.url));
  if (req.headers.length) {
    parts.push("  headers: {\n" + req.headers.map(function (h) { return "    " + JSON.stringify(h.name) + ": " + headerValueJS(h); }).join(",\n") + "\n  }");
  }
  const body = bodyString(req);
  if (body !== null) { parts.push("  data: " + JSON.stringify(body)); }
  if (req.form && req.form.length) {
    lines.push("const FormData = require(\"form-data\");");
    lines.push("const form = new FormData();");
    req.form.forEach(function (f) { lines.push("form.append(" + JSON.stringify(f.name) + ", " + JSON.stringify(f.value) + ");"); });
    parts.push("  data: form");
  }
  lines.push("const response = await axios({\n" + parts.join(",\n") + "\n});");
  lines.push("console.log(response.data);");
  return lines.join("\n");
}

function generatePython(req) {
  const lines = ["import os", "import requests", ""];
  lines.push("url = " + JSON.stringify(req.url));
  if (req.headers.length) {
    lines.push("headers = {\n" + req.headers.map(function (h) { return "    " + JSON.stringify(h.name) + ": " + headerValuePy(h); }).join(",\n") + "\n}");
  } else { lines.push("headers = {}"); }
  const body = bodyString(req);
  const args = [];
  if (req.headers.length) { args.push("headers=headers"); }
  if (body !== null) {
    if (req.json) { args.push("json=" + pyLiteral(body)); }
    else { args.push("data=" + JSON.stringify(body)); }
  }
  if (req.form && req.form.length) {
    lines.push("files = {\n" + req.form.map(function (f) { return "    " + JSON.stringify(f.name) + ": (None, " + JSON.stringify(f.value) + ")"; }).join(",\n") + "\n}");
    args.push("files=files");
  }
  lines.push("response = requests." + req.method.toLowerCase() + "(url" + (args.length ? ", " + args.join(", ") : "") + ")");
  lines.push("print(response.text)");
  return lines.join("\n");
}
function pyLiteral(jsonText) {
  try { return JSON.stringify(JSON.parse(jsonText), null, 2).replace(/true/g, "True").replace(/false/g, "False").replace(/null/g, "None"); }
  catch (e) { return JSON.stringify(jsonText); }
}

function generateGo(req) {
  const lines = ["package main", "", "import (", '\t"bytes"', '\t"fmt"', '\t"io"', '\t"net/http"', '\t"os"', ")", "", "func main() {"];
  const body = bodyString(req);
  if (req.form && req.form.length) {
    lines.push('\t// Multipart form fields from the original request:');
    req.form.forEach(function (f) { lines.push("\t// " + f.name + " = " + f.value); });
    lines.push('\t// Build the multipart body with mime/multipart before sending.');
  }
  if (body !== null) {
    lines.push("\tbody := bytes.NewBufferString(" + JSON.stringify(body) + ")");
    lines.push('\treq, err := http.NewRequest("' + req.method + '", ' + JSON.stringify(req.url) + ", body)");
  } else {
    lines.push('\treq, err := http.NewRequest("' + req.method + '", ' + JSON.stringify(req.url) + ", nil)");
  }
  lines.push("\tif err != nil { panic(err) }");
  (req.headers || []).forEach(function (h) {
    lines.push('\treq.Header.Set(' + JSON.stringify(h.name) + ", " + headerValueGo(h) + ")");
  });
  lines.push("\tresp, err := http.DefaultClient.Do(req)");
  lines.push("\tif err != nil { panic(err) }");
  lines.push("\tdefer resp.Body.Close()");
  lines.push("\tout, _ := io.ReadAll(resp.Body)");
  lines.push("\tfmt.Println(string(out))");
  lines.push("}");
  return lines.join("\n");
}

function generatePHP(req) {
  const lines = ["<?php", "", "$ch = curl_init();", "curl_setopt($ch, CURLOPT_URL, " + JSON.stringify(req.url) + ");", "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);"];
  if (req.method === "POST") { lines.push("curl_setopt($ch, CURLOPT_POST, true);"); }
  else if (req.method !== "GET") { lines.push("curl_setopt($ch, CURLOPT_CUSTOMREQUEST, " + JSON.stringify(req.method) + ");"); }
  const body = bodyString(req);
  if (body !== null) { lines.push("curl_setopt($ch, CURLOPT_POSTFIELDS, " + JSON.stringify(body) + ");"); }
  if (req.form && req.form.length) {
    lines.push("$form = [");
    req.form.forEach(function (f) { lines.push("    " + JSON.stringify(f.name) + " => " + JSON.stringify(f.value) + ","); });
    lines.push("];");
    lines.push("curl_setopt($ch, CURLOPT_POSTFIELDS, $form);");
  }
  if (req.headers && req.headers.length) {
    lines.push("$headers = [");
    req.headers.forEach(function (h) {
      if (h.env) { lines.push('    "' + h.name + ': " . getenv("' + h.env + '"),'); }
      else { lines.push("    " + JSON.stringify(h.name + ": " + h.value) + ","); }
    });
    lines.push("];");
    lines.push("curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);");
  }
  lines.push("$response = curl_exec($ch);");
  lines.push("curl_close($ch);");
  lines.push("echo $response;");
  return lines.join("\n");
}

function generateCurl(req) {
  const parts = ["curl " + JSON.stringify(req.url)];
  if (req.method !== "GET") { parts.push("-X " + req.method); }
  (req.headers || []).forEach(function (h) {
    const v = h.env ? "__ENV_" + h.env + "__" : h.value;
    parts.push("-H " + JSON.stringify(h.name + ": " + v));
  });
  const body = bodyString(req);
  if (body !== null) { parts.push("-d " + JSON.stringify(body)); }
  (req.form || []).forEach(function (f) { parts.push("-F " + JSON.stringify(f.name + "=" + f.value)); });
  return parts.join(" \\\n  ");
}

function convert(input, target) {
  const req = prepare(input);
  const gens = { fetch: generateFetch, axios: generateAxios, python: generatePython, go: generateGo, php: generatePHP, curl: generateCurl };
  const gen = gens[target] || generateFetch;
  return { code: gen(req), warnings: req.warnings || [], request: req };
}
function convertAll(input) {
  const req = prepare(input);
  return {
    request: req, warnings: req.warnings || [],
    fetch: generateFetch(req), axios: generateAxios(req), python: generatePython(req),
    go: generateGo(req), php: generatePHP(req), curl: generateCurl(req)
  };
}

// Basic back conversion: fetch(...) code to a request object, then to cURL.
function fetchToCurl(code) {
  const s = String(code || "");
  const urlMatch = s.match(/fetch\(\s*["'`]([^"'`]+)["'`]/);
  if (!urlMatch) { return { error: "No fetch( call with a URL string was found.", warnings: [] }; }
  const req = { method: "GET", url: urlMatch[1], headers: [], data: null, dataFields: [], form: [], warnings: ["Back conversion is basic: dynamic values, variables and template strings are not resolved."] };
  const methodMatch = s.match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/);
  if (methodMatch) { req.method = methodMatch[1].toUpperCase(); }
  const headerBlock = s.match(/headers\s*:\s*\{([\s\S]*?)\}/);
  if (headerBlock) {
    const re = /["'`]([^"'`]+)["'`]\s*:\s*["'`]([^"'`]*)["'`]/g;
    let m;
    while ((m = re.exec(headerBlock[1])) !== null) { req.headers.push({ name: m[1], value: m[2] }); }
  }
  const bodyMatch = s.match(/body\s*:\s*(?:JSON\.stringify\()?\s*["'`]([\s\S]*?)["'`]\s*\)?/);
  if (bodyMatch) { req.data = bodyMatch[1]; }
  return { code: generateCurl(req), warnings: req.warnings, request: req };
}

function pythonToCurl(code) {
  const s = String(code || "");
  const urlMatch = s.match(/url\s*=\s*["']([^"']+)["']/) || s.match(/requests\.\w+\(\s*["']([^"']+)["']/);
  if (!urlMatch) { return { error: "No URL was found in the Python code.", warnings: [] }; }
  const methodMatch = s.match(/requests\.(\w+)\(/);
  const req = { method: methodMatch ? methodMatch[1].toUpperCase() : "GET", url: urlMatch[1], headers: [], data: null, dataFields: [], form: [], warnings: ["Back conversion is basic: variables and f-strings are not resolved."] };
  const headerBlock = s.match(/headers\s*=\s*\{([\s\S]*?)\}/);
  if (headerBlock) {
    const re = /["']([^"']+)["']\s*:\s*["']([^"']*)["']/g;
    let m;
    while ((m = re.exec(headerBlock[1])) !== null) { req.headers.push({ name: m[1], value: m[2] }); }
  }
  const dataMatch = s.match(/data\s*=\s*["']([^"']*)["']/);
  if (dataMatch) { req.data = dataMatch[1]; }
  return { code: generateCurl(req), warnings: req.warnings, request: req };
}

const api = { tokenizeCurl, parseCurl, extractSecrets, envNameForHeader, generateFetch, generateAxios, generatePython, generateGo, generatePHP, generateCurl, convert, convertAll, fetchToCurl, pythonToCurl };
if (typeof module !== "undefined" && module.exports) { module.exports = api; }
if (typeof window !== "undefined") { window.CurlToCodeBatch = api; }
