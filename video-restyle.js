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
 * Using ffmpeg, create a mask for this motion.
 */
async function maskMotion(
    fromFrame, toFrame, toImage
) {
    if (await exists(toImage))
        return;

    const cmd = ["ffmpeg", "-loglevel", "error"];

    // Input all the files
    for (let fi = fromFrame; fi <= toFrame; fi++)
        cmd.push("-i", `in/${six(fi)}.png`);

    // Make the filtergraph
    let filterGraph = "[0:v]format=y8,geq=lum=0[mask]";
    let ii = 1;
    for (let fi = fromFrame + 1; fi <= toFrame; fi++) {
        filterGraph +=
            `;[${ii-1}:v][${ii}:v]blend=difference,format=y8[part]
            ;[mask][part]blend=addition[mask]`;
        ii++;
    }
    filterGraph += ";[mask]format=y8";
    for (let i = 0; i < 16; i++) {
        let max = "0";
        for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
                max = `max(${max}\\,p(${x}+X\\,${y}+Y))`;
            }
        }
        filterGraph += `,geq=lum=${max}`;
    }
    filterGraph += "[mask]";

    cmd.push(
        "-filter_complex", filterGraph,
        "-map", "[mask]",
        "-update", "1",
        toImage
    );
    await run(cmd);
}

/**
 * Create a blank mask using this as a template.
 */
async function blankMask(fromImage, toImage) {
    await run([
        "ffmpeg",
        "-loglevel", "error",
        "-i", fromImage,
        "-vf", "format=y8,geq=lum=255",
        "-update", "1",
        toImage
    ]);
}

/**
 * Using ffmpeg, merge this forward image and this backward image using this
 * mask.
 */
async function mergeMask(
    forward, backward, mask, to
) {
    await run([
        "ffmpeg",
        "-loglevel", "error",
        "-i", forward, "-i", backward, "-i", mask,
        "-filter_complex", `
            [2:v]format=y8,geq=lum=0.5*p(X\\,Y)[mask];
            [1:v][mask]alphamerge[b];
            [0:v][b]overlay[img]
        `,
        "-map", "[img]",
        to
    ]);
}

/**
 * Using stable-restyle, restyle this.
 */
async function restyle(promptFile, inp, mask, out) {
    if (await exists(out))
        return;
    console.log(out);
    return sr.restyle(promptFile, inp, mask, out);
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

        // Mask-interpolate up
        await maskMotion(lo+1, mid+1, `interp/${six(midSlide)}-m.png`);

        // Mix
        await mergeMask(
            `interp/${six(midSlide)}-f.png`,
            `interp/${six(midSlide)}-b.png`,
            `interp/${six(midSlide)}-m.png`,
            `interp/${six(midSlide)}.png`
        );

        // And restyle
        await restyle(
            "claymation.json",
            `interp/${six(midSlide)}.png`, `interp/${six(midSlide)}-m.png`,
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
    const promises = Array(frameCt).fill(null);
    const meta = {unlocks, locks, promises};

    // First frame is a direct translation
    await blankMask("in/000001.png", "interp/000001-m.png");
    promises[0] = locks[0].then(async () => {
        await restyle(
            "claymation.json",
            "in/000001.png", "interp/000001-m.png",
            "out/000001.png"
        );
    });

    const groupSize = ~~(1024 / framesPerSlide) * framesPerSlide;

    // Binary-restyle in groups of (usually) 1024
    let idx;
    for (idx = groupSize; idx < frameCt - 1; idx += groupSize) {
        const gidx = idx;
        promises[idx] = locks[idx].then(async () => {
            await restyle(
                "claymation.json",
                `in/${six(gidx+1)}.png`, `interp/000001-m.png`,
                `out/${six(gidx/framesPerSlide+1)}.png`
            );
        });
        binaryRestyle(meta, idx - groupSize, idx);
    }

    // And the last group
    promises[frameCt-1] = locks[frameCt-1].then(async () => {
        await restyle(
            "claymation.json",
            `in/${six(frameCt)}.png`, `interp/000001-m.png`,
            `out/${six(frameCt/framesPerSlide)}.png`
        );
    });
    binaryRestyle(meta, idx - groupSize, frameCt-1);

    // Then wait for promises
    for (idx = 0; idx < frameCt; idx++) {
        unlocks[idx]();
        await promises[idx];
    }
}

main();
