import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const value = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
};
const schemaDir = resolve(value("--schema-dir"));
const artifactDir = resolve(value("--artifact-dir"));
const schemas = [
  ["environment.schema.json", "environment-manifest.json"],
  ["scheduler.schema.json", "scheduler-manifest.json"],
  ["source-image.schema.json", "image-manifest.json"],
];
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const validate = (schema, data, root, path = "$") => {
  if (schema.$ref) return validate(root[schema.$ref.slice(2).split("/")[0]]?.[schema.$ref.slice(2).split("/")[1]], data, root, path);
  if (schema.const !== undefined && data !== schema.const) throw new Error(`${path} must equal ${schema.const}`);
  if (schema.enum && !schema.enum.includes(data)) throw new Error(`${path} is not an allowed value`);
  if (schema.type === "object") {
    if (!isObject(data)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!(key in data)) throw new Error(`${path}.${key} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) if (!(key in (schema.properties ?? {}))) throw new Error(`${path}.${key} is not allowed`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in data) validate(child, data[key], root, `${path}.${key}`);
  }
  if (schema.type === "array") {
    if (!Array.isArray(data)) throw new Error(`${path} must be an array`);
    if (schema.minItems && data.length < schema.minItems) throw new Error(`${path} needs ${schema.minItems} items`);
    for (const [index, item] of data.entries()) validate(schema.items, item, root, `${path}[${index}]`);
  }
  if (schema.type === "string") {
    if (typeof data !== "string") throw new Error(`${path} must be a string`);
    if (schema.minLength && data.length < schema.minLength) throw new Error(`${path} is too short`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(data))) throw new Error(`${path} does not match its pattern`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(data))) throw new Error(`${path} is not a date-time`);
    if (schema.format === "uri" && !/^https?:\/\//.test(data)) throw new Error(`${path} is not an HTTP URI`);
  }
  if (schema.type === "integer" && (!Number.isInteger(data) || (schema.minimum !== undefined && data < schema.minimum) || (schema.maximum !== undefined && data > schema.maximum))) throw new Error(`${path} is not within integer bounds`);
};
for (const [schemaFile, artifactFile] of schemas) {
  const schema = JSON.parse(readFileSync(resolve(schemaDir, schemaFile), "utf8"));
  const artifact = JSON.parse(readFileSync(resolve(artifactDir, artifactFile), "utf8"));
  validate(schema, artifact, schema);
  console.log(`${artifactFile} validates against ${schemaFile}`);
}
