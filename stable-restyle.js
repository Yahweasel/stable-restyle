#!/usr/bin/env node
const fs = require("fs/promises");
const genImg = require("./generate-img");
const path = require("path");

const backend = "http://127.0.0.1:7821";

async function main() {
    const outBase = path.dirname(process.argv[1]);

    const prompt = JSON.parse(await fs.readFile(`${outBase}/workflow_api.json`, "utf8"));
    const sr = prompt["stable-restyle"];
    delete prompt["stable-restyle"];
    prompt[sr.inputs[0]].inputs.image_base64 = (await fs.readFile(process.argv[2])).toString("base64");
    prompt[sr.inputs[1]].inputs.image_base64 = (await fs.readFile(process.argv[3])).toString("base64");
    const outPrefix = ("" + Math.random() + Math.random() + Math.random()).replace(/\./g, "");
    prompt[sr.output].inputs.filename_prefix = `stable-restyle-out/${outPrefix}`;

    await genImg.generateImg(`${outBase}/out/${outPrefix}`, backends, prompt);

    await genImg.run(["mv", `${outBase}/out/${outPrefix}_00001_.png`, process.argv[4]]);
}
main();
