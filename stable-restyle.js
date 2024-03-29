#!/usr/bin/env node
const fs = require("fs/promises");
const genImg = require("./generate-img");
const path = require("path");

const backends = [
    "http://127.0.0.1:7821",
    //"http://127.0.0.1:7822"
];

async function main() {
    process.chdir(path.dirname(process.argv[1]));

    const files = await fs.readdir("in/");
    const promptText = await fs.readFile("workflow_api.json");

    const promises = [];
    const inProgress = [];
    const jobs = Array(backends.length).fill(0);

    for (const file of files) {
        if (!/\.png$/.test(file))
            continue;
        console.log(file);

        while (promises.length >= backends.length * 2)
            await Promise.race(promises);

        // Make the prompt
        const base = file.replace(/\.png$/, "");
        const inFile = (await fs.readFile(`in/${file}`)).toString("base64");
        const outBase = `out/${base}`;
        const outPromptBase = `stable-restyle-out/${base}`;
        const prompt = JSON.parse(promptText);
        prompt["15"].inputs.image_base64 = inFile;
        prompt["9"].inputs.filename_prefix = outPromptBase;

        // Choose a backend
        let bid = 0;
        let bct = Number.POSITIVE_INFINITY;
        for (let i = 0; i < jobs.length; i++) {
            if (jobs[i] < bct) {
                bid = i;
                bct = jobs[i];
            }
        }

        // And schedule it
        jobs[bid]++;
        inProgress.push(outBase);
        promises.push((async () => {
            await genImg.generateImg(outBase, backends[0], prompt);
            const idx = inProgress.indexOf(outBase);
            inProgress.splice(idx, 1);
            promises.splice(idx, 1);
        })());
    }

    await Promise.all(promises);
}
main();
