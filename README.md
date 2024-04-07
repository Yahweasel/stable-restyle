This tool restyles video using Stable Diffusion img2img. The image restyling is
fairly standard: it inputs the image as the latent image (“initial” image), as
well as a mask. The trick is how it uses this to somewhat-stably¹ restyle video.

To use this tool at all, you will need to run ComfyUI through [Stable Swarm
UI](https://github.com/Stability-AI/StableSwarmUI.git), and symlink (or `sshfs`,
whatever) its `dlbackend/ComfyUI/output/stable-restyle-out` directory to a
`stable-restyle-out` directory here. You can change the `backends` variable in
`stable-restyle.js` to correspond to your particular installation.

You also need to check out the `motion-transfer` subrepository (`git submodule
init`, `git submodule update`) and build `motion-transfer` there with `make`.

To restyle video, put the input video frames as six-digit PNG files in an `in`
directory, numbered from `000001.png`. Such a sequence can be created easily
with FFmpeg: `ffmpeg -i <input file> 'in/%06d.png'`. Then, just run
`video-restyle.js` and wait a very long time. The resulting frames will be
stored in `out`.

`video-restyle.js` takes several options:

 * `--model <model file>`: Provide a ComfyUI API file for the model with which
   to restyle. See `claymation.json` for an example. It is a standard ComfyUI
   workflow API file, with an added `"stable-restyle"` element that describes
   where `stable-restyle` should put the input, mask, and output.

 * `--mask-strength <strength>`: Given a number between 0 and 8, controls the
   strength of the mask that encourages stability. A mask of strength 8 will
   *only* allow the AI to change the image where movement is detected, while a
   mask strength of 0 will allow the API to change the entire image. The
   default, 2, seems to work best for most models.

 * `--fps <frames-per-slide>`: Control the number of input frames per output
   frame (called “frames” and “slides” to keep the terms distinct). The default
   is 2, which will, e.g., turn 24FPS input into 12FPS output.

The provided workflows convert images to claymation (`claymation.json`) and
quasi-anime (`anime.json`) using these models:
 * https://civitai.com/models/208168/claymate-claymation-style-for-sdxl
 * https://civitai.com/models/269232/aam-xl-anime-mix

¹ Don't expect magic. It's only *somewhat* stable!


## How it works

I have tried many techniques, and this one is the best I've discovered so far.
That's not quite the same as saying that it's *good*, however!

First, the video is divided into scenes using FFmpeg's `scdet` filter.
Everything else happens on a per-scene basis.

For each scene, the middle frame (rounded down) is chosen as a starting point.
That frame is converted into a slide with full freedom (i.e., a white mask).
Then, it proceeds down and up from there to fill out the entire scene.

In either direction, it first makes an interpolated image based on the motion
between the frame and the next frame, using `motion-transfer`. `motion-transfer`
works by encoding the frames using a video encoder, then applying the motion
frames from the video encoder to the slide instead of the input frame. This
interpolated frame is mixed with the original frame at the same point, and that
mixed frame becomes the input for the AI for that slide.

The mask input is created by taking the difference between the frames, then
spreading light pixels. That is, the AI is given more freedom to change the
output nearest to where the input itself changed. This mask is compressed into
the lightest portion of the range based on `--mask-strength`, as I've found that
AI performs this task best when it has reasonable freedom to change the entire
image, and the mask is used more to *concentrate* its attention than to
*restrict* its attention.

That interpolated input frame and mask are sent to the AI, and its result
becomes the slide.

This technique has relatively low parallelism since every slide depends on the
previous slide. But, the parallelism is increased by (a) performing every scene
independently, and (b) starting in the middle of the scene and interpolating in
both directions.

The results are fine, not great. I feel like what's really missing is a
sufficiently sophisticated motion transfer that less change needs to be done in
the first place. But, I haven't found a good way to do it.
