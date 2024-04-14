#!/usr/bin/env node
/*
 * Copyright (c) 2024 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER
 * RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF
 * CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

const fs = require("fs/promises");
const genImg = require("./generate-img");
const path = require("path");

const backends = [
    "http://127.0.0.1:7821",
    //"http://127.0.0.1:7822"
];

const backendQueueSizes = Array(backends.length).fill(0);
const backendPromises = backendQueueSizes.map(x => Promise.all([]));

/**
 * Restyle these two images into this image using this prompt (all filenames).
 */
async function restyle(promptFile, inp, mask, out) {
    // Choose a backend
    let backendIdx = 0;
    let blen = backendQueueSizes[0];
    for (let bi = 1; bi < backends.length; bi++) {
        if (backendQueueSizes[bi] >= Number.POSITIVE_INFINITY)
            console.log(`Backend ${bi} is down`);
        if (backendQueueSizes[bi] < blen) {
            backendIdx = bi;
            blen = backendQueueSizes[bi];
        }
    }
    const backend = backends[backendIdx];
    backendQueueSizes[backendIdx]++;

    const promise = backendPromises[backendIdx].then(async () => {
        // Make the prompt
        const prompt = JSON.parse(await fs.readFile(promptFile, "utf8"));
        const sr = prompt["stable-restyle"];
        delete prompt["stable-restyle"];
        prompt[sr.input].inputs.image_base64 = (await fs.readFile(inp)).toString("base64");
        prompt[sr.mask].inputs.image_base64 = (await fs.readFile(mask)).toString("base64");
        const outPrefix = ("" + Math.random() + Math.random() + Math.random()).replace(/\./g, "");
        prompt[sr.output].inputs.filename_prefix = `stable-restyle-out/${outPrefix}`;

        // Generate the image
        await genImg.generateImg(`${__dirname}/stable-restyle-out/${outPrefix}`, backend, prompt);
        await genImg.run(["mv", `${__dirname}/stable-restyle-out/${outPrefix}_00001_.png`, out]);

        backendQueueSizes[backendIdx]--;
    });
    backendPromises[backendIdx] = promise.catch(console.error);

    try {
        return await promise;
    } catch (ex) {
        // Backend failed
        backendQueueSizes[backendIdx] = Number.POSITIVE_INFINITY;
        return await restyle(promptFile, inp, mask, out);
    }
}

module.exports = {restyle};
