import { z } from "zod";

export const FolderTreeType = z.enum(["folder", "file"]);

export type FolderTreeFolder = {
  name: string;
  type: "folder";
  children: FolderTree[];
};

export type FolderTreeFile = {
  name: string;
  type: "file";
  id: string;
};

export type FolderTree = FolderTreeFolder | FolderTreeFile;

export const FolderTreeSchema: z.ZodType<FolderTree> = z.discriminatedUnion(
  "type",
  [
    z.object({
      name: z.string(),
      type: z.literal("folder"),
      children: z.array(z.lazy(() => FolderTreeSchema)),
    }),
    z.object({
      name: z.string(),
      type: z.literal("file"),
      id: z.string(),
    }),
  ]
);

const internalGetObjectById = (
  folderTree: FolderTree,
  path: string = ""
): [PropertyKey, FolderTree][] => {
  if (folderTree.type === "file") {
    return [[folderTree.id, folderTree]];
  }

  return folderTree.children
    .reduce((acc, e) => {
      return acc.concat(internalGetObjectById(e, path + "/" + folderTree.name));
    }, [] as [PropertyKey, FolderTree][])
    .concat([[path + "/" + folderTree.name, folderTree]]);
};

export const getMapObjectById = (
  folderTree: FolderTree
): Record<string, FolderTree> => {
  return Object.fromEntries(internalGetObjectById(folderTree));
};

export const getFiles = (folderTree: FolderTree): FolderTreeFile[] => {
  if (folderTree.type === "file") {
    return [folderTree];
  }

  return folderTree.children.flatMap(getFiles);
};

const internalGetObjectToPathMap = (
  folderTree: FolderTree,
  path: string = ""
): [PropertyKey, string][] => {
  if (folderTree.type === "file") {
    return [[folderTree.id, path]];
  }

  return folderTree.children
    .reduce((acc, e) => {
      return acc.concat(
        internalGetObjectToPathMap(e, path + "/" + folderTree.name)
      );
    }, [] as [PropertyKey, string][])
    .concat([[path + "/" + folderTree.name, path]]);
};

export const getObjectToPathMap = (
  folderTree: FolderTree
): Record<string, string> => {
  const obj = internalGetObjectToPathMap(folderTree);
  return Object.fromEntries(obj);
};

export const groupObjectIdsByPath = (
  folderTree: FolderTree
): Record<string, string[]> => {
  const fileIdToPathMap = getObjectToPathMap(folderTree);

  return Object.entries(fileIdToPathMap).reduce((acc, [id, path]) => {
    acc[path] = acc[path] || [];
    acc[path].push(id);
    return acc;
  }, {} as Record<string, string[]>);
};
