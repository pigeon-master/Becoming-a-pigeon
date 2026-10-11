# Human photograph texture

Asset: `public/models/human-photo-atlas.png`.
Generated and edited with the built-in image_gen tool using the imagegen skill.
The reference was the user's second image, locally available as `스크린샷 2026-10-10 145337.png`.
The final sheet contains a front and back photograph of the same East Asian man, in a T-pose, with black hair, black eyeglasses, white shirt, charcoal trousers and black shoes. It retains transparency.

The photograph is projected onto a simple jointed 3D volume in its T-pose. The resulting UV coordinates stay attached to each limb during walking and posing. The model is not a full photogrammetry scan. Photos are loaded before the visit starts.

The head uses a single smooth volume. Sleeves, trouser legs and the neck use tapered smooth surfaces; separate rounded nose, ears, hair, collars, cuffs and finger pieces were removed. The figure is scaled to 115%. After a two-second standing pause it strikes the pose in 0.2 seconds.

The upper sleeve has a smooth rounded root embedded inside the torso so its cut surface is concealed during the pose. Sleeve UVs sample fabric, while hand UVs sample skin on the photograph separately. Each shoe is a single half ellipsoid, with a curved upper surface and a closed flat bottom at its horizontal cut. Hands are enlarged by 10%; the face is widened from .43 to .47 and deepened from .38 to .41 while preserving photograph alignment.

## Initial generation prompt

Use case: identity-preserve. Asset type: photorealistic front/back character texture projection sheet for an articulated simple 3D human in a web scene. Reference image: preserve THIS same young blond man's facial likeness, swept light blond hair, white unbuttoned-collar long-sleeve shirt, dark charcoal tailored trousers, black belt, black shoes. Replace the seated crossed-arms pose with neutral standing T-pose, arms fully horizontal, open hands, legs straight slightly apart. Produce ONE square transparent PNG containing TWO equal vertical panels: LEFT exact straight-on FRONT orthographic full-body T-pose; RIGHT exact straight-on BACK orthographic full-body T-pose of the SAME man wearing the SAME clothing. Each complete figure centered in its half, identical scale, soles at same height and crown at same height. Arms span almost the entire panel width with small clear margins; feet and head must not be cropped. Real photographed skin and fabric, natural shirt and trouser creases, detailed face matching the reference; flat diffuse lighting for texture projection, no cast shadows, no gradients behind person. Actual transparent background in both panels. No dividing lines, no text, no props, no additional views. Must feel like a scanned human photograph rather than cartoon sculpting. White shirt tucked into charcoal trousers.

## Final edit prompt

Latest outfit edit (built-in image_gen, 2026-10-11), saved in `public/models/human-photo-atlas.png`. The curved neck uses its own untextured skin material so the plaid collar cannot project onto bare skin. Head scale is .94; the head is shifted .5 forward relative to the shoulders.

Use case: identity-preserve. Edit target: the transparent two-view T-pose texture atlas (front on left, back on right). Clothing reference: the attached standing man wearing a black/white/gray plaid shirt, loose light-blue jeans and gray/white running sneakers. Change ONLY the atlas person's clothing to this reference outfit: long-sleeved black-white-gray plaid button-up shirt, untucked hem, visible collar and closed buttons, loose pale blue washed denim trousers, gray mesh running sneakers with pale gray/white soles and laces. Keep exactly the existing atlas man's face, black hair, black eyeglasses, skin, slender body, full-body T-pose, arm spread, figure scale, centers, and front/back layout. No backpack or crossbody bag in the texture, those are separate 3D accessories. Clearly separate bare skin of the neck from plaid shirt collar; no plaid on skin, no skin on cloth. Same outfit front and back. Preserve exact transparent background, square image, full figures including shoes, neutral diffuse photographic texture lighting, no floor, text, logos or extra people. This is a photo projection texture atlas, not an illustration or finished scene.

Previous face edit:

Edit this photorealistic front/back T-pose character texture sheet. Change ONLY the person's face and hair in both views: an adult East Asian man with natural East Asian facial features, short neat BLACK hair (absolutely no blond/brown hair), wearing BLACK rectangular thick framed prescription eyeglasses with clear lenses. Keep the same white open-collar long sleeve shirt, charcoal gray trousers, belt, black shoes, identical body proportions and exact front/back T-pose positioning and scale. Same person in both front and back. Preserve transparent background. For web 3D photograph projection, realistic skin and fabric detail, neutral diffuse light. Correctly orient glasses and black hair in back view. No text or extra elements. Do not move, resize or crop the bodies.
