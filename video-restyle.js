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
    filterGraph += ";[mask]format=y8,geq=lum=min(p(X\\,Y)*4+128\\,255)";
    for (let i = 0; i < 8; i++) {
        let max = "0";
        for (let y = -1; y <= 1; y++) {
            for (let x = -1; x <= 1; x++) {
                max = `max(${max}\\,p(${x}+X\\,${y}+Y))`;
            }
        }
        filterGraph += `,geq=lum=${max}`;
    }
    filterGraph += ",unsharp=lx=9:ly=9:la=-1.5[mask]";

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
    if (await exists(toImage))
        return;

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
    if (await exists(to))
        return;

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

async function main() {
    let framesPerSlide = 2;

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

    // First frame is a direct translation
    await blankMask("in/000001.png", "interp/000001-m.png");
    await restyle(
        "claymation.json",
        "in/000001.png", "interp/000001-m.png",
        "out/000001.png"
    );

    let slide = 1;
    for (let frame = 1 + framesPerSlide; frame < frameCt; frame += framesPerSlide) {
        slide++;

        // Interpolate the motion
        await interpolateMotion(
            frame - framesPerSlide, frame, 1,
            `out/${six(slide-1)}.png`, `interp/${six(slide)}-f.png`
        );

        // Figure out the mask
        await maskMotion(
            frame - framesPerSlide, frame,
            `interp/${six(slide)}-m.png`
        );

        // Mask the frame
        await mergeMask(
            `interp/${six(slide)}-f.png`, `in/${six(frame)}.png`,
            `interp/${six(slide)}-m.png`, `interp/${six(slide)}.png`
        );

        await restyle(
            "claymation.json",
            `interp/${six(slide)}.png`, `interp/${six(slide)}-m.png`,
            `out/${six(slide)}.png`
        );
    }
}

main();
