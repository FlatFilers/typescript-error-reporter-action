import * as _ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { FileEntry } from '../types'
import { libDTS } from '../gen/libDTS'

const libDTSRegexp = /^lib\..*\.d\.ts$/

/**
 * @description Creates a Language Service Host object that provides file-related
 * functionality for TypeScript compilation, including reading files, resolving module
 * names, and getting script snapshots.
 * 
 * @param {string[]} fileNames - Used to pass in an array of file names to be processed
 * by the language service host.
 * 
 * @param {_ts.CompilerOptions} compilerOptions - Used to provide options for the
 * TypeScript compiler.
 * 
 * @param {FileEntry} fileEntry - Used to store file metadata, including file names
 * and versions.
 * 
 * @param {typeof _ts} ts - Used to access the Language Service Host API, which
 * provides methods for resolving module names, reading files, and other language-related
 * functionality.
 * 
 * @returns {_ts.LanguageServiceHost} An object that provides various methods for
 * resolving module names, reading files, and getting script snapshots.
 */
export const createHost = (fileNames: string[], compilerOptions: _ts.CompilerOptions, fileEntry: FileEntry, ts: typeof _ts): _ts.LanguageServiceHost => {
  const getCurrentVersion = (fileName: string) => fileEntry.has(fileName) ? fileEntry.get(fileName)!.version : 0
  const getTextFromSnapshot = (snapshot: _ts.IScriptSnapshot) => snapshot.getText(0, snapshot.getLength())

  /**
   * @description Reads a file synchronously and returns its contents as a string or
   * undefined on error.
   * 
   * @param {string} fileName - Used to represent the name of the file to be read.
   * 
   * @param {string | undefined} encoding - Used to specify the encoding of the file content.
   * 
   * @returns {string} The contents of the file specified by the `fileName` parameter
   * or undefined if an error occurs while reading the file.
   */
  const readFile = (fileName: string, encoding: string | undefined = 'utf8') => {
    if (libDTSRegexp.test(fileName)) {
      return libDTS[fileName].content
    }

    fileName = path.normalize(fileName);
    try {
      return fs.readFileSync(fileName, encoding);
    } catch (e) {
      return undefined;
    }
  }

  /**
   * @description Reads a file at the specified path using the `ts.sys.readFile()`
   * method or falls back to reading it using the `readFile()` function if the former
   * fails due to invalid file path or encoding options.
   * 
   * @param {string} filePath - Used to specify the path to the file that needs to be
   * read.
   * 
   * @returns {string | null} The contents of the file at the specified path, or a
   * fallback value if the file does not exist or cannot be read.
   */
  const readFileWithFallback = (
    filePath: string,
    encoding?: string | undefined
  ) => {
    return ts.sys.readFile(filePath, encoding) || readFile(filePath, encoding)
  }

  const moduleResolutionHost: _ts.ModuleResolutionHost = {
    /**
     * @description Checks whether a file exists or not by checking if the file exists
     * or if it returns an undefined value when read.
     * 
     * @returns {boolean} 1 if the file exists and 0 otherwise.
     */
    fileExists: fileName => {
      return ts.sys.fileExists(fileName) || readFile(fileName) !== undefined
    },
    /**
     * @description Retrieves file content from a file entry and returns it as text. If
     * the file exists, it uses the file's script snapshot to retrieve the content.
     * Otherwise, it falls back to reading the file using a different method.
     * 
     * @returns {string} The contents of a file.
     */
    readFile: fileName => {
      if (fileEntry.has(fileName)) {
        const snapshot = fileEntry.get(fileName)!.scriptSnapshot
        return getTextFromSnapshot(snapshot)
      }
      return readFileWithFallback(fileName)
    },
    realpath: ts.sys.realpath,
    directoryExists: ts.sys.directoryExists,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getDirectories: ts.sys.getDirectories
  }

  const host: _ts.LanguageServiceHost = {
    getScriptFileNames: () => fileNames,
    getScriptVersion: fileName => getCurrentVersion(fileName) + '',
    /**
     * @description Retrieves the script snapshot for a given file name, checking if it
     * exists and parsing its contents as needed.
     * 
     * @returns {ts.ScriptSnapshot} A snapshot of a TypeScript script represented as a
     * JavaScript object.
     */
    getScriptSnapshot: fileName => {
      if (fileEntry.has(fileName)) {
        return fileEntry.get(fileName)!.scriptSnapshot
      } else {
        const isLibDTS = libDTSRegexp.test(fileName)
        if (!isLibDTS && !fs.existsSync(fileName)) {
          return undefined
        }
        const content = isLibDTS ? libDTS[fileName].content : fs.readFileSync(fileName).toString()

        const scriptSnapshot = ts.ScriptSnapshot.fromString(content)
        fileEntry.set(fileName, { version: 0, scriptSnapshot })
        return scriptSnapshot
      }
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    /**
     * @description Maps each input `moduleName` to a resolved module object or undefined,
     * taking into account whether the name ends with `.vue$`. If it does, it returns a
     * custom resolved module object; otherwise, it resolves the module using TypeScript's
     * `ts.resolveModuleName` method and returns the resulting resolved module object.
     * 
     * @param {string[]} moduleNames - Used to provide a list of module names to resolve.
     * 
     * @param {string} containingFile - Passed as an argument to help identify the file
     * where the modules are being resolved, which allows the function to correctly
     * determine the module resolution.
     * 
     * @param {any} _ - Not used or mentioned again in the code snippet provided, so its
     * purpose is unknown or unspecified.
     * 
     * @param {unknown} __ - Used to store the result of the module resolution process.
     * 
     * @param {ts.ResolutionOptions} options - Used to customize the module resolution process.
     * 
     * @returns {_ts.ResolvedModule | undefined} An array of resolved module names.
     */
    resolveModuleNames: (moduleNames, containingFile, _, __, options) => {
      const ret: (_ts.ResolvedModule | undefined)[] = moduleNames.map(name => {
          // Maps a list of module names to their resolved modules. If a module name ends with
          // ".vue", it returns a custom resolved module object with the file path normalized
          // and resolved. Otherwise, it invokes the `ts.resolveModuleName()` method to retrieve
          // the resolved module information for the given module name.

          if (/\.vue$/.test(name)) {
            const resolved: _ts.ResolvedModule = {
              resolvedFileName: normalize(path.resolve(path.dirname(containingFile), name))
            }
            return resolved
          }

          const { resolvedModule } = ts.resolveModuleName(
              name,
              containingFile,
              options,
              moduleResolutionHost
          );
          return resolvedModule
      });
      return ret;
    },
    fileExists: moduleResolutionHost.fileExists,
    readFile: moduleResolutionHost.readFile,
    readDirectory: ts.sys.readDirectory,
    getDirectories: ts.sys.getDirectories,
    realpath: moduleResolutionHost.realpath
  }

  return host
}

// .ts suffix is needed since the compiler skips compile
// if the file name seems to be not supported types
/**
 * @description Normalizes a given file name by replacing the file extension `.vue$`
 * with `.ts`, if the file name matches the pattern `/.vue$/.test(fileName)`. Otherwise,
 * it returns the original file name unchanged.
 * 
 * @param {string} fileName - Intended to represent the file name to be normalized,
 * which may or may not end with the `.vue` suffix.
 * 
 * @returns {string} Either the original file name or the modified file name with the
 * extension changed to ".ts" if the file name ends with ".vue$".
 */
function normalize (fileName: string): string {
  if (/\.vue$/.test(fileName)) {
    return fileName + '.ts'
  }
  return fileName
}
