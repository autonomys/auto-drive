import fsPromises from 'fs/promises'
import fs from 'fs'
import path from 'path'

export const writeFile = async (
  filepath: string,
  data: AsyncIterable<Buffer>,
  ensureDirectoryExistance: boolean = true,
) => {
  const tempFilePath = `${filepath}.tmp`

  if (ensureDirectoryExistance) {
    await asyncEnsureDirectoryExists(path.dirname(tempFilePath))
  }

  await fsPromises.writeFile(tempFilePath, data)
  await fsPromises.rename(tempFilePath, filepath)
}

export const ensureDirectoryExists = (dir: string) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export const asyncEnsureDirectoryExists = async (dir: string) => {
  if (!(await fsPromises.stat(dir).catch(() => false))) {
    await fsPromises.mkdir(dir, { recursive: true })
  }
  return dir
}
