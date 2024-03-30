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

const cproc = require("child_process");
const fs = require("fs/promises");

/**
 * Send this prompt to the AI.
 */
async function sendPrompt(backend, prompt) {
    const f = await fetch(`${backend}/prompt`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({prompt})
    });
    await f.text();
}

/**
 * Wait for this file to exist.
 */
async function waitForFile(name) {
    while (true) {
        try {
            await fs.access(name, fs.constants.F_OK);
            break;
        } catch (ex) {}
        await new Promise(res => setTimeout(res, 1000));
    }
    await new Promise(res => setTimeout(res, 1000));
}

/**
 * Run this command.
 */
function run(cmd) {
    return new Promise(res => {
        const p = cproc.spawn(cmd[0], cmd.slice(1), {
            stdio: ["ignore", "inherit", "inherit"]
        });
        p.on("exit", (code, signal) => {
            if (code === null)
                res(-1);
            else
                res(code);
        });
    });
}

/**
 * Generate an image with this prompt.
 * @param oname  Output name prefix.
 * @param backend  Backend to send the prompt to.
 * @param prompt  Prompt to use.
 */
async function generateImg(oname, backend, prompt) {
    // Check if it's already been made
    let exists = false;
    try {
        await fs.access(`${oname}_00001_.png`, fs.constants.F_OK);
        exists = true;
    } catch (ex) {}

    if (!exists) {
        await sendPrompt(backend, prompt);

        // Wait for it to exist
        await waitForFile(`${oname}_00001_.png`);
    }
}

module.exports = {run, generateImg};
