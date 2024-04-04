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

const cproc = require("child_process");
const fs = require("fs/promises");
const genImg = require("./generate-img");
const sr = require("./stable-restyle");

let framesPerSlide = 2;

/**
 * Does this file exist?
 */
async function exists(file) {
    try {
        await fs.access(file, fs.constants.F_OK);
        return true;
    } catch (ex) {
        return false;
    }
}

/**
 * Run this command.
 */
function run(args) {
    console.log(args.join(" "));
    return genImg.run(args);
}

/**
 * Expand this number to six digits.
 */
function six(num) {
    return num.toString().padStart(6, "0");
}

/**
 * Using motion-transfer, interpolate this motion.
 */
async function interpolateMotion(
    fromFrame, toFrame, step,
    fromImage, toImage
) {
    if (await exists(toImage))
        return;

    const cmd = [`${__dirname}/motion-transfer/motion-transfer`, "-m"];
    let fi;
    for (fi = fromFrame; fi != toFrame; fi += step)
        cmd.push(`in/${six(fi)}.png`);
    cmd.push(
        `in/${six(fi)}.png`,
        "-i", fromImage,
        "-o", toImage
    );
    await run(cmd);
}

/**
 * Using stable-restyle, restyle this.
 */
async function restyle(promptFile, in1, in2, out) {
    if (await exists(out))
        return;
    return sr.restyle(promptFile, in1, in2, out);
}

/**
 * Restyle this by binary combination from lo to hi.
 */
function binaryRestyle(meta, lo, hi) {
    if (hi <= lo + 1)
        return;

    let mid = ~~((hi + lo) / 2);
    while ((mid%framesPerSlide) != 0)
        mid++;
    if (mid >= hi)
        mid -= framesPerSlide;
    if (mid <= lo)
        return;

    meta.promises[mid] = meta.locks[mid].then(async () => {
        meta.unlocks[lo]();
        meta.unlocks[hi]();
        await meta.promises[lo];
        await meta.promises[hi];

        const loSlide = ~~(lo / framesPerSlide) + 1;
        const midSlide = ~~(mid / framesPerSlide) + 1;
        const hiSlide = ~~(hi / framesPerSlide) + 1;

        // Motion-interpolate up
        await interpolateMotion(
            lo+1, mid+1, 1,
            `out/${six(loSlide)}.png`,
            `interp/${six(midSlide)}-f.png`
        );

        // And down
        await interpolateMotion(
            hi+1, mid+1, -1,
            `out/${six(hiSlide)}.png`,
            `interp/${six(midSlide)}-b.png`
        );

        // And restyle
        await restyle(
            "claymation14.json",
            `interp/${six(midSlide)}-f.png`, `interp/${six(midSlide)}-b.png`,
            `out/${six(midSlide)}.png`
        );
    });

    // Subdivide
    binaryRestyle(meta, lo, mid);
    binaryRestyle(meta, mid, hi);
}

async function main() {
    for (let ai = 2; ai < process.argv.length; ai++) {
        const arg = process.argv[ai];
        switch (arg) {
            case "--fps":
                framesPerSlide = +process.argv[++ai];
                break;

            default:
                console.error(`Unrecognized argument ${arg}`);
                process.exit(1);
        }
    }

    await run(["mkdir", "-p", "interp"]);
    await run(["mkdir", "-p", "out"]);

    // Count frames
    let frameCt;
    for (frameCt = 1;; frameCt++) {
        if (!(await exists(`in/${six(frameCt)}.png`))) {
            frameCt--;
            break;
        }
    }
    frameCt = ~~(frameCt / framesPerSlide) * framesPerSlide;

    // Create all the frame locks
    const unlocks = Array(frameCt).fill(null);
    const locks = Array(frameCt).fill(null).map((x, i) => new Promise(res => unlocks[i] = res));
    console.log(locks);
    const promises = Array(frameCt).fill(null);
    const meta = {unlocks, locks, promises};

    // First frame is a direct translation
    promises[0] = locks[0].then(async () => {
        await restyle(
            "claymation14.json",
            "in/000001.png", "in/000001.png",
            "out/000001.png"
        );
    });

    const groupSize = ~~(1024 / framesPerSlide) * framesPerSlide;

    // Binary-restyle in groups of (usually) 1024
    let idx;
    for (idx = groupSize; idx < frameCt - 1; idx += groupSize) {
        promises[idx] = locks[idx].then(async () => {
            await restyle(
                "claymation14.json",
                `in/${six(idx+1)}.png`, `in/${six(idx+1)}.png`,
                `out/${six(idx/framesPerSlide+1)}.png`
            );
        });
        binaryRestyle(meta, idx - groupSize, idx);
    }

    // And the last group
    promises[frameCt-1] = locks[frameCt-1].then(async () => {
        await restyle(
            "claymation14.json",
            `in/${six(frameCt)}.png`, `in/${six(frameCt)}`,
            `out/${six(frameCt/framesPerSlide)}.out`
        );
    });
    binaryRestyle(meta, idx, frameCt-1);

    // Then wait for promises
    for (idx = 0; idx < frameCt; idx++) {
        unlocks[idx]();
        await promises[idx];
    }
}

main();
