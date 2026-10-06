import type { Attributes } from "graphology-types";
import { createEdgeArrowHeadProgram, createEdgeCompoundProgram, EdgeRectangleProgram } from "sigma/rendering";
import type { EdgeProgramType } from "sigma/rendering";

/**
 * Cạnh nét đứt có mũi tên, dùng cho quan hệ có điều kiện.
 *
 * Sigma không có sẵn kiểu cạnh nét đứt. Nó vẽ mỗi cạnh là một hình chữ nhật
 * mảnh bằng WebGL (EdgeRectangleProgram); chương trình dưới đây là hình chữ
 * nhật đó với hai shader được viết lại:
 *
 *   - vertex shader tính thêm v_dist: khoảng cách từ đầu cạnh tới điểm đang
 *     vẽ, tính bằng pixel trên màn hình
 *   - fragment shader bỏ những điểm rơi vào "khoảng hở" của nét đứt
 *
 * Tính theo pixel màn hình (chứ không theo toạ độ của đồ thị) để nét đứt dài
 * như nhau ở mọi mức phóng to.
 *
 * Phần còn lại của hai shader chép từ sigma 3.0.3 (edge-rectangle). Nếu nâng
 * sigma mà cạnh nét đứt vẽ sai, đây là chỗ cần so lại.
 */

/** Độ dài một nét và một khoảng hở, tính bằng pixel. */
const DASH = "6.0";
const GAP = "4.0";

// language=GLSL
const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_zoomRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_dist;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness, 1)).xy, 0, 1);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  // Sigma đổi pixel sang toạ độ đồ thị bằng cách nhân với
  // u_correctionRatio / u_sizeRatio (xem webGLThickness ở trên); chia cho tỉ
  // lệ đó thì đổi ngược chiều dài của cạnh về pixel.
  float edgeLength = length(a_positionEnd - a_positionStart);
  v_dist = a_positionCoef * edgeLength * u_sizeRatio / u_correctionRatio;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

// language=GLSL
const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_dist;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

void main(void) {
  // Điểm rơi vào khoảng hở thì không vẽ.
  if (mod(v_dist, ${DASH} + ${GAP}) > ${DASH}) discard;

  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;

  float t = smoothstep(
    v_thickness - v_feather,
    v_thickness,
    dist
  );

  gl_FragColor = mix(v_color, transparent, t);
  #endif
}
`;

class DashedLineProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
> extends EdgeRectangleProgram<N, E, G> {
  override getDefinition() {
    return { ...super.getDefinition(), VERTEX_SHADER_SOURCE: VERTEX_SHADER, FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER };
  }
}

/**
 * Nét đứt cộng một đầu mũi tên ở phía đích. Thân cạnh chạy tới tận tâm của
 * node đích; phần nằm dưới node bị chính node che đi.
 */
export function createDashedArrowProgram<
  N extends Attributes = Attributes,
  E extends Attributes = Attributes,
  G extends Attributes = Attributes,
>(): EdgeProgramType<N, E, G> {
  return createEdgeCompoundProgram<N, E, G>([DashedLineProgram<N, E, G>, createEdgeArrowHeadProgram<N, E, G>()]);
}
