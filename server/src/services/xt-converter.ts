import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { convertStepToGltf } from "./converter.js";

const execFileAsync = promisify(execFile);

export async function convertXtToStep(
  inputPath: string,
  outputPath: string
): Promise<string> {
  try {
    await execFileAsync("assimp", [
      "export",
      inputPath,
      outputPath,
      "--format=step",
    ]);
    return outputPath;
  } catch {
    throw new Error(
      "x_t 转换失败：服务器未安装 assimp。请先安装：brew install assimp (macOS) 或 apt install assimp-utils (Linux)"
    );
  }
}

export async function convertXtToGltf(
  inputPath: string,
  outputDir: string,
  modelId?: string,
  originalName?: string
) {
  const stepPath = `${inputPath}.converted.step`;
  await convertXtToStep(inputPath, stepPath);
  return convertStepToGltf(stepPath, outputDir, modelId, stepPath);
}
