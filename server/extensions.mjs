import { basename, dirname, extname } from 'node:path'

/** Project SDK metadata into plain JSON. Never expose factories or runtime state. */
export function extensionLoadReport(result, error = null) {
  return {
    extensions: result.extensions.map((extension) => {
      const path = extension.resolvedPath || extension.path
      const file = basename(path, extname(path))
      const entry = file === 'index' ? basename(dirname(path)) : file
      const source = extension.sourceInfo?.source ?? ''
      const packageName = source.startsWith('npm:') ? source.slice(4).replace(/@[^/]*$/, '') : ''
      const packageLeaf = packageName.split('/').at(-1)
      const name = packageName
        ? entry === packageLeaf || entry === 'src' || entry === 'dist'
          ? packageName
          : `${packageName} / ${entry}`
        : entry
      return {
        name,
        path,
        source,
        scope: extension.sourceInfo?.scope ?? '',
        tools: [...extension.tools.keys()].sort(),
        commands: [...extension.commands.keys()].sort(),
        events: [...extension.handlers.keys()].sort(),
      }
    }).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
    errors: result.errors.map(({ path, error }) => ({ path, error })),
    warnings: (result.warnings ?? []).map(({ path, warning }) => ({ path, warning })),
    error,
  }
}

export function emptyExtensionReport() {
  return { extensions: [], errors: [], warnings: [], error: null }
}
