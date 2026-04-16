import { createId } from "@/lib/utils";

export type FishResourceType = "image" | "spine" | "spritesheet";

export interface FishResource {
  id: string;
  name: string;
  type: FishResourceType;
  url?: string;
  files: File[];
  spineData?: {
    json?: string;
    atlas?: string;
    png?: string;
    pngs?: Record<string, string>;
  };
}

export async function parseFilesToFishResources(files: File[]): Promise<FishResource[]> {
  const resources: FishResource[] = [];

  const allFiles = Array.from(files);
  const imageFiles = allFiles.filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    return ext === "png" || ext === "jpg" || ext === "jpeg";
  });
  const atlasFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith(".atlas"));
  const jsonFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith(".json"));
  const plistFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith(".plist"));

  const processedImageNames = new Set<string>();

  for (const atlasFile of atlasFiles) {
    const baseName = atlasFile.name.replace(/\.atlas$/i, "");
    const jsonFile = jsonFiles.find((f) => f.name.replace(/\.json$/i, "") === baseName);
    if (!jsonFile) continue;

    const atlasText = await atlasFile.text();
    const lines = atlasText.split(/\r?\n/);
    const spineImageNames: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.endsWith(".png") || trimmed.endsWith(".jpg") || trimmed.endsWith(".jpeg")) {
        spineImageNames.push(trimmed);
      }
    }

    if (spineImageNames.length === 0) spineImageNames.push(`${baseName}.png`);

    const spineImages = imageFiles.filter((f) => spineImageNames.includes(f.name));
    if (spineImages.length === 0) continue;

    const pngUrls: Record<string, string> = {};
    const resourceFiles: File[] = [jsonFile, atlasFile];
    for (const img of spineImages) {
      pngUrls[img.name] = URL.createObjectURL(img);
      resourceFiles.push(img);
      processedImageNames.add(img.name);
    }

    resources.push({
      id: createId(),
      name: baseName,
      type: "spine",
      url: URL.createObjectURL(jsonFile),
      spineData: {
        json: URL.createObjectURL(jsonFile),
        atlas: URL.createObjectURL(atlasFile),
        png: pngUrls[spineImageNames[0]] || Object.values(pngUrls)[0],
        pngs: pngUrls,
      },
      files: resourceFiles,
    });
  }

  for (const plistFile of plistFiles) {
    const baseName = plistFile.name.replace(/\.plist$/i, "");
    const pngFile = imageFiles.find((f) => f.name.replace(/\.(png|jpg|jpeg)$/i, "") === baseName);
    if (!pngFile) continue;

    processedImageNames.add(pngFile.name);

    resources.push({
      id: createId(),
      name: baseName,
      type: "spritesheet",
      url: URL.createObjectURL(plistFile),
      spineData: { png: URL.createObjectURL(pngFile) },
      files: [plistFile, pngFile],
    });
  }

  for (const imgFile of imageFiles) {
    if (processedImageNames.has(imgFile.name)) continue;
    const baseName = imgFile.name.replace(/\.(png|jpg|jpeg)$/i, "");

    resources.push({
      id: createId(),
      name: baseName,
      type: "image",
      url: URL.createObjectURL(imgFile),
      files: [imgFile],
    });
  }

  return resources;
}

export function revokeFishResourceObjectUrls(resource: FishResource) {
  if (resource.url) URL.revokeObjectURL(resource.url);
  if (resource.spineData?.json) URL.revokeObjectURL(resource.spineData.json);
  if (resource.spineData?.atlas) URL.revokeObjectURL(resource.spineData.atlas);
  if (resource.spineData?.png) URL.revokeObjectURL(resource.spineData.png);
  if (resource.spineData?.pngs) {
    Object.values(resource.spineData.pngs).forEach((u) => URL.revokeObjectURL(u));
  }
}

