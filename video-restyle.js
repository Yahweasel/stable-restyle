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

let model = "claymation.json";
let maskStrength = 2;
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
 * Get the scene changes in the input.
 */
async function sceneChanges(frameCt) {
    const sceneFile = "interp/scenes.json";
    if (await exists(sceneFile))
        return JSON.parse(await fs.readFile(sceneFile, "utf8"));

    // Compute scene changes
    const p = cproc.spawn("ffmpeg", [
        "-nostats",
        "-framerate", "1", "-i", "in/%06d.png",
        "-vf", "scdet",
        "-f", "rawvideo", "-y", "/dev/null"
    ], {
        stdio: ["ignore", "inherit", "pipe"]
    });
    let stderr = "";
    await new Promise(res => {
        p.stderr.on("data", chunk => {
            stderr += chunk.toString("utf8");
        });
        p.stderr.on("end", res);
    });

    // Parse
    const scenes = [0];
    for (const line of stderr.split("\n")) {
        const parts = /^\[scdet.*lavfi\.scd\.time: ([0-9]*)/.exec(line);
        if (!parts)
            continue;
        scenes.push(+parts[1]);
    }
    scenes.push(frameCt);

    // Cache
    await fs.writeFile(sceneFile, JSON.stringify(scenes));

    return scenes;
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
    fromFrame, toFrame, step, toImage
) {
    if (await exists(toImage))
        return;

    const cmd = ["ffmpeg", "-loglevel", "error"];

    // Input all the files
    for (let fi = fromFrame; fi !== toFrame; fi += step)
        cmd.push("-i", `in/${six(fi)}.png`);

    // Make the filtergraph
    let filterGraph = "[0:v]format=y8,geq=lum=0[mask]";
    let ii = 1;
    for (let fi = fromFrame + step; fi !== toFrame; fi += step) {
        filterGraph +=
            `;[${ii-1}:v][${ii}:v]blend=difference,format=y8[part]
            ;[mask][part]blend=addition[mask]`;
        ii++;
    }
    filterGraph += `;[mask]format=y8,geq=lum=min(p(X\\,Y)*${maskStrength}+${256-32*maskStrength}\\,255)`;
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

/**
 * Convert this scene.
 */
async function convertScene(lo, hi) {
    // Find the middle point
    const mid = ~~((lo+hi)/2/framesPerSlide) * framesPerSlide;
    const midFrame = mid + 1;
    const midSlide = mid / framesPerSlide + 1;

    // Middle frame is a direct translation
    await blankMask(`in/${six(midFrame)}.png`, `interp/${six(midSlide)}-m.png`);
    await restyle(
        model,
        `in/${six(midFrame)}.png`, `interp/${six(midSlide)}-m.png`,
        `out/${six(midSlide)}.png`
    );

    // Convert down
    for (let fi = mid - framesPerSlide; fi >= lo; fi -= framesPerSlide) {
        const frame = fi + 1;
        const slide = fi / framesPerSlide + 1;

        // Interpolate the motion
        await interpolateMotion(
            frame + framesPerSlide, frame, -1,
            `out/${six(slide+1)}.png`, `interp/${six(slide)}-b.png`
        );

        // Compute the mask
        await maskMotion(
            frame + framesPerSlide, frame, -1,
            `interp/${six(slide)}-m.png`
        );

        // Merge the mask
        await mergeMask(
            `interp/${six(slide)}-b.png`, `in/${six(frame)}.png`,
            `interp/${six(slide)}-m.png`, `interp/${six(slide)}.png`
        );

        // And restyle
        await restyle(
            model,
            `interp/${six(slide)}.png`, `interp/${six(slide)}-m.png`,
            `out/${six(slide)}.png`
        );
    }

    // And up
    for (let fi = mid + framesPerSlide; fi < hi; fi += framesPerSlide) {
        const frame = fi + 1;
        const slide = fi / framesPerSlide + 1;
        await interpolateMotion(
            frame - framesPerSlide, frame, 1,
            `out/${six(slide-1)}.png`, `interp/${six(slide)}-f.png`
        );
        await maskMotion(
            frame - framesPerSlide, frame, 1,
            `interp/${six(slide)}-m.png`
        );
        await mergeMask(
            `interp/${six(slide)}-f.png`, `in/${six(frame)}.png`,
            `interp/${six(slide)}-m.png`, `interp/${six(slide)}.png`
        );
        await restyle(
            model,
            `interp/${six(slide)}.png`, `interp/${six(slide)}-m.png`,
            `out/${six(slide)}.png`
        );
    }
}

async function main() {
    for (let ai = 2; ai < process.argv.length; ai++) {
        const arg = process.argv[ai];
        switch (arg) {
            case "--model":
                model = process.argv[++ai];
                break;

            case "--mask-strength":
                maskStrength = +process.argv[++ai];
                break;

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

    // Find scenes
    const scenes = await sceneChanges(frameCt);

    // And convert them
    const promises = [];
    for (let si = 0; si < scenes.length - 1; si++) {
        promises.push(convertScene(scenes[si], scenes[si+1]));
        while (promises.length >= 16)
            await promises.shift();
    }
    await Promise.all(promises);
}

main();
