import { getStorage } from "./index";
import type { UploadBase64Params, UploadBase64Result } from "./types";

export async function uploadBase64Asset(params: UploadBase64Params): Promise<UploadBase64Result> {
  return getStorage().uploadBase64(params);
}
