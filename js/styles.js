// Sensor looks as full-screen post-process shaders.
const HEAD = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + czm_frameNumber * 0.37) * 43758.5453); }
float vignette(vec2 uv) { vec2 d = uv - 0.5; return smoothstep(0.85, 0.25, length(d)); }
`;

const SHADERS = {
  crt: HEAD + `
void main() {
  vec2 uv = v_textureCoordinates;
  vec2 d = uv - 0.5; uv = 0.5 + d * (1.0 + 0.06 * dot(d, d)); // slight barrel
  float r = texture(colorTexture, uv + vec2(0.0015, 0.0)).r;
  float g = texture(colorTexture, uv).g;
  float b = texture(colorTexture, uv - vec2(0.0015, 0.0)).b;
  vec3 c = vec3(r, g, b);
  float scan = 0.82 + 0.18 * sin(v_textureCoordinates.y * czm_viewport.w * 3.14159);
  c *= scan * vignette(v_textureCoordinates) * 1.15;
  out_FragColor = vec4(c, 1.0);
}`,
  nvg: HEAD + `
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = pow(lum(c), 0.75) * 1.5;
  l += (rand(v_textureCoordinates) - 0.5) * 0.12;
  vec3 g = vec3(0.12, 1.0, 0.35) * l;
  out_FragColor = vec4(g * vignette(v_textureCoordinates), 1.0);
}`,
  flir: HEAD + `
vec3 ironbow(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.0, 0.0, 0.05), b = vec3(0.35, 0.0, 0.55), c = vec3(0.9, 0.2, 0.2), d = vec3(1.0, 0.7, 0.0), e = vec3(1.0, 1.0, 0.9);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = lum(c);
  l += (rand(v_textureCoordinates) - 0.5) * 0.04;
  out_FragColor = vec4(ironbow(l * 1.15), 1.0);
}`,
  noir: HEAD + `
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = lum(c);
  l = smoothstep(0.05, 0.85, l);
  l += (rand(v_textureCoordinates) - 0.5) * 0.06;
  out_FragColor = vec4(vec3(l) * vignette(v_textureCoordinates), 1.0);
}`,
};

export class Styles {
  constructor(viewer) { this.viewer = viewer; this.stage = null; this.current = 'normal'; }

  set(name) {
    const stages = this.viewer.scene.postProcessStages;
    if (this.stage) { stages.remove(this.stage); this.stage = null; }
    this.current = SHADERS[name] ? name : 'normal';
    if (SHADERS[name]) {
      this.stage = stages.add(new Cesium.PostProcessStage({ name: 'gel_' + name, fragmentShader: SHADERS[name] }));
    }
    document.querySelectorAll('#styles button').forEach((b) => b.classList.toggle('on', b.dataset.style === this.current));
  }
}

export const STYLE_ORDER = ['normal', 'crt', 'nvg', 'flir', 'noir'];
