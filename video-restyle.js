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
    const cmd = ["./motion-transfer/motion-transfer", "-m"];
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

async function main() {
    let framesPerSlide = 4;
    let slidesPerKey = 4;

    for (let ai = 2; ai < process.argv.length; ai++) {
        const arg = process.argv[ai];
        switch (arg) {
            case "--fps":
                framesPerSlide = +process.argv[++ai];
                break;

            case "--spk":
                slidesPerKey = +process.argv[++ai];
                break;

            default:
                console.error(`Unrecognized argument ${arg}`);
                process.exit(1);
        }
    }

    const framesPerKey = framesPerSlide * slidesPerKey;

    await run(["mkdir", "-p", "interp"]);
    await run(["mkdir", "-p", "out"]);

    // First frame is a direct translation
    console.log(1);
    await sr.restyle(
        "claymation14.json",
        "in/000001.png", "in/000001.png",
        "out/000001.png"
    );

    let outSlide = 1;

    // One key at a time...
    for (let keyNum = 1 + framesPerKey;; keyNum += framesPerKey) {
        if (!(await exists(`in/${six(keyNum)}.png`)))
            break;

        // Interpolate the motion forward
        await interpolateMotion(
            keyNum - framesPerKey, keyNum, 1,
            `out/${six(outSlide)}.png`,
            `interp/${six(outSlide + slidesPerKey)}.png`
        );
        outSlide += slidesPerKey;

        // Regenerate the final frame with AI
        const finalFramePromise = sr.restyle(
            "claymation14.json",
            `in/${six(keyNum)}.png`, `interp/${six(outSlide)}.png`,
            `out/${six(outSlide)}.png`
        );

        // Regenerate the first half with forward AI
        const forwardPromise = (async () => {
            for (let i = 1; i < slidesPerKey/2; i++) {
                const inSlide = keyNum - framesPerKey + i*framesPerSlide;
                const out = outSlide - slidesPerKey + i;
                await interpolateMotion(
                    inSlide - framesPerSlide, inSlide, 1,
                    `out/${six(out-1)}.png`,
                    `interp/${six(out)}.png`
                );
                console.log(out);
                await sr.restyle(
                    "claymation17.json",
                    `in/${six(inSlide)}.png`, `interp/${six(out)}.png`,
                    `out/${six(out)}.png`
                );
            }
        })();

        // Regenerate the second half with backward AI
        const backwardPromise = finalFramePromise.then(async () => {
            for (let i = 1; i < slidesPerKey/2; i++) {
                const inSlide = keyNum - i*framesPerSlide;
                const out = outSlide - i;
                await interpolateMotion(
                    inSlide + framesPerSlide, inSlide, -1,
                    `out/${six(out+1)}.png`,
                    `interp/${six(out)}.png`
                );
                console.log(out);
                await sr.restyle(
                    "claymation17.json",
                    `in/${six(inSlide)}.png`, `interp/${six(out)}.png`,
                    `out/${six(out)}.png`
                );
            }
        });

        // If there's a middle frame, regenerate that from both
        let middlePromise = Promise.all([]);
        if (slidesPerKey%2 === 0) middlePromise = middlePromise.then(async () => {
            await forwardPromise;
            await backwardPromise;

            const i = slidesPerKey/2;
            const inSlide = keyNum - i*framesPerSlide;
            const out = outSlide - i;
            await interpolateMotion(
                inSlide - framesPerSlide, inSlide, 1,
                `out/${six(out-1)}.png`,
                `interp/${six(out)}-f.png`
            );
            await interpolateMotion(
                inSlide + framesPerSlide, inSlide, -1,
                `out/${six(out+1)}.png`,
                `interp/${six(out)}-b.png`
            );
            await run([
                "ffmpeg", "-loglevel", "error",
                "-i", `interp/${six(out)}-f.png`,
                "-i", `interp/${six(out)}-b.png`,
                "-filter_complex", "[0:v][1:v]blend=all_expr=A*0.5+B*0.5[vid]",
                "-map", "[vid]",
                "-y", "-update", "1",
                `interp/${six(out)}.png`
            ]);
            console.log(out);
            await sr.restyle(
                "claymation17.json",
                `in/${six(inSlide)}.png`, `interp/${six(out)}.png`,
                `out/${six(out)}.png`
            );
        });

        await Promise.all([
            finalFramePromise, forwardPromise, backwardPromise, middlePromise
        ]);
    }
}

main();
