import type { Packument } from '#shared/types'
import Arborist from '@npmcli/arborist'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, rm, writeFile } from 'node:fs/promises'

/**
 * Result of install size calculation
 */
export interface InstallSizeResult {
  /** Package name */
  package: string
  /** Package version */
  version: string
  /** Unpacked size of the package itself (bytes) */
  selfSize: number
  /** Total unpacked size including all dependencies (bytes) */
  totalSize: number
  /** Number of dependencies (including transitive) */
  dependencyCount: number
  /** Breakdown of dependency sizes */
  dependencies: DependencySize[]
}

export interface DependencySize {
  name: string
  version: string
  size: number
  /** True if this is an optional dependency */
  optional?: boolean
}

/**
 * Cached function to fetch unpacked size for a specific package version
 */
export const fetchPackageSize = defineCachedFunction(
  async (name: string, version: string): Promise<number> => {
    try {
      const encodedName = name.startsWith('@')
        ? `@${encodeURIComponent(name.slice(1))}`
        : encodeURIComponent(name)

      const packument = await $fetch<Packument>(`https://registry.npmjs.org/${encodedName}`)

      const versionData = packument.versions[version]
      if (!versionData?.dist) {
        return 0
      }

      // dist.unpackedSize may not be present on older packages
      return (versionData.dist as { unpackedSize?: number }).unpackedSize ?? 0
    } catch {
      return 0
    }
  },
  {
    // Cache for 24 hours - sizes don't change for published versions
    maxAge: 60 * 60 * 24,
    name: 'package-size',
    getKey: (name: string, version: string) => `${name}@${version}`,
  },
)

/**
 * Calculate the total install size for a package.
 *
 * We resolve dependencies for a specific platform (linux-x64) so that
 * arborist naturally selects only the appropriate platform-specific
 * optional dependencies, just like a real install would.
 */
export const calculateInstallSize = defineCachedFunction(
  async (name: string, version: string): Promise<InstallSizeResult> => {
    // Create a temporary directory for arborist to work in
    const tempDir = join(
      tmpdir(),
      `npmx-arborist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )

    try {
      await mkdir(tempDir, { recursive: true })

      // Create a minimal package.json with the target as a dependency
      const packageJson = {
        name: 'temp-size-calc',
        version: '1.0.0',
        dependencies: {
          [name]: version,
        },
      }
      await writeFile(join(tempDir, 'package.json'), JSON.stringify(packageJson))

      // Use arborist to build the ideal tree, pretending we're on linux-x64
      // This ensures we only get one platform-specific binary per package,
      // just like a real install would
      const arb = new Arborist({
        path: tempDir,
        registry: 'https://registry.npmjs.org',
        ignoreScripts: true,
        // Resolve for linux-x64 with glibc - a common CI/server environment
        os: 'linux',
        cpu: 'x64',
        libc: 'glibc',
      } as Arborist.Options)

      const tree = await arb.buildIdealTree()

      // Collect all dependencies from the tree
      const deps: Map<string, { name: string; version: string; optional: boolean }> = new Map()

      // Walk the tree using the inventory
      for (const node of tree.inventory.values()) {
        // Skip the root package (location is empty string for root)
        // Also skip if the path is the temp directory itself
        if (node.isRoot || node.location === '' || node.path === tempDir) continue

        // Skip inert nodes - these are optional deps that don't match the platform
        // (arborist marks them inert based on os/cpu/libc options)
        if ((node as unknown as { inert?: boolean }).inert) continue

        const pkgName = node.name
        const pkgVersion = node.version
        if (!pkgVersion) continue

        const key = `${pkgName}@${pkgVersion}`
        if (deps.has(key)) continue

        const isOptional = node.optional || node.devOptional
        deps.set(key, { name: pkgName, version: pkgVersion, optional: isOptional })
      }

      // Fetch sizes for all dependencies in parallel
      const sizePromises = Array.from(deps.values()).map(async dep => {
        const size = await fetchPackageSize(dep.name, dep.version)
        return {
          name: dep.name,
          version: dep.version,
          size,
          optional: dep.optional || undefined,
        } satisfies DependencySize
      })

      const dependencies = await Promise.all(sizePromises)

      // Calculate totals
      let totalSize = 0
      let dependencyCount = 0
      const finalDependencies: DependencySize[] = []

      // Get self size (the main package)
      const selfSize = await fetchPackageSize(name, version)
      totalSize += selfSize

      for (const dep of dependencies) {
        // Skip the main package itself from dependencies list
        if (dep.name === name && dep.version === version) continue

        totalSize += dep.size
        dependencyCount += 1
        finalDependencies.push(dep)
      }

      // Sort dependencies by size descending
      finalDependencies.sort((a, b) => b.size - a.size)

      return {
        package: name,
        version,
        selfSize,
        totalSize,
        dependencyCount,
        dependencies: finalDependencies,
      }
    } finally {
      // Clean up temp directory
      try {
        await rm(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    }
  },
  {
    // Cache for 1 hour - dependency resolutions can change with new releases
    maxAge: 60 * 60,
    name: 'install-size',
    getKey: (name: string, version: string) => `${name}@${version}`,
  },
)
