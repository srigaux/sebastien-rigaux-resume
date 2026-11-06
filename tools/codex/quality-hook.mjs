import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const hash = (value) => createHash('sha256').update(value).digest('hex')
const code = /\.(?:[cm]?js|[cm]?ts|jsx|tsx|astro)$/i
const continuation = '[codex-quality]'

function command(root, executable, args) {
  if (
    executable === 'pnpm' &&
    args[0] === 'prepush' &&
    !existsSync(path.join(root, 'node_modules/lefthook/bin/index.js'))
  ) {
    return {
      ok: false,
      output:
        'Dependencies are missing. Run pnpm install before validating; the hook does not install packages.',
    }
  }

  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
  return {
    ok: result.status === 0 && !result.error,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`,
  }
}

async function snapshot(root) {
  const result = command(root, 'git', [
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z',
  ])

  if (!result.ok) {
    throw new Error('Unable to list repository files')
  }

  const files = [
    ...new Set(
      result.output
        .split('\0')
        .filter((file) => file && !file.startsWith('.local/codex-quality/'))
    ),
  ].sort()
  const entries = []

  for (let start = 0; start < files.length; start += 32) {
    entries.push(
      ...(await Promise.all(
        files.slice(start, start + 32).map(async (file) => {
          const absolute = path.resolve(root, file)

          if (!absolute.startsWith(`${root}${path.sep}`)) {
            return null
          }

          try {
            // Do not follow symlinks into another checkout or outside the repository.
            if (!(await lstat(absolute)).isFile()) {
              return null
            }

            return [file, hash(await readFile(absolute))]
          } catch (error) {
            if (error.code === 'ENOENT') {
              return null
            }

            throw error
          }
        })
      ))
    )
  }

  return Object.fromEntries(entries.filter(Boolean))
}

const signature = (files) => hash(JSON.stringify(files))

async function acquire(directory) {
  const lock = path.join(directory, 'lock')

  for (let attempt = 0; attempt < 2400; attempt++) {
    try {
      await mkdir(lock)
      await writeFile(path.join(lock, 'pid'), String(process.pid))
      return () => rm(lock, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error
      }

      try {
        const pid = Number(await readFile(path.join(lock, 'pid'), 'utf8'))

        if (pid > 0) {
          try {
            process.kill(pid, 0)
          } catch (failure) {
            if (failure.code === 'ESRCH') {
              await rm(lock, { recursive: true, force: true })
            }
          }
        }
      } catch (failure) {
        // A process may still be creating the lock's pid file.
        if (failure.code !== 'ENOENT') {
          throw failure
        }

        try {
          if (Date.now() - (await lstat(lock)).mtimeMs > 10_000) {
            await rm(lock, { recursive: true, force: true })
          }
        } catch (missing) {
          if (missing.code !== 'ENOENT') {
            throw missing
          }
        }
      }

      await delay(100)
    }
  }

  throw new Error('Quality hook is busy; validation was not completed')
}

async function autoFix(root, files, execute) {
  const output = []

  // Keep batches small enough for OS argument limits, including paths with spaces.
  for (let start = 0; start < files.length; start += 50) {
    const batch = files
      .slice(start, start + 50)
      .map((file) => path.join(root, file))
    const scripts = batch.filter((file) => code.test(file))

    if (scripts.length) {
      const result = await execute(root, process.execPath, [
        path.join(root, 'node_modules/eslint/bin/eslint.js'),
        '--fix',
        '--no-warn-ignored',
        // Imports can be added before their usages in a later edit.
        '--rule',
        'unused-imports/no-unused-imports: off',
        '--',
        ...scripts,
      ])
      output.push(result.output)
    }

    const result = await execute(root, process.execPath, [
      path.join(root, 'node_modules/prettier/bin/prettier.cjs'),
      '--write',
      '--ignore-unknown',
      '--',
      ...batch,
    ])
    output.push(result.output)
  }

  return output.join('\n')
}

/** Process one documented Codex lifecycle payload; never modify Git's index. */
export async function runHook(
  input,
  {
    root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    execute = command,
  } = {}
) {
  root = path.resolve(root)

  if (!input.session_id || input.permission_mode === 'plan') {
    return {}
  }

  const directory = path.join(root, '.local/codex-quality')
  await mkdir(directory, { recursive: true })
  const release = await acquire(directory)

  try {
    const id = hash(String(input.session_id)).slice(0, 24)
    const statePath = path.join(directory, `${id}.json`)
    let state

    try {
      state = JSON.parse(await readFile(statePath, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    const current = await snapshot(root)
    const save = () => writeFile(statePath, JSON.stringify(state))

    if (input.hook_event_name === 'UserPromptSubmit') {
      if (state?.blocked && input.prompt?.startsWith(continuation)) {
        return {}
      }

      state = {
        observed: current,
        baseline: signature(current),
        blocked: false,
        validation: state?.validation,
      }
      await save()
      return {}
    }

    // Without a prompt baseline, do not claim ownership of existing dirty files.
    if (!state) {
      return {}
    }

    const changed = Object.keys(current).filter(
      (file) => current[file] !== state.observed[file]
    )

    if (input.hook_event_name === 'PostToolUse') {
      if (!changed.length) {
        return {}
      }

      await writeFile(
        path.join(directory, `${id}-fix.log`),
        await autoFix(root, changed, execute)
      )
      state.observed = await snapshot(root)
      await save()
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Quality hook processed targeted ESLint/Prettier corrections for ${changed.length} changed file(s), without staging. Pending diagnostics are checked at Stop. Do not repeat these formatting commands manually.`,
        },
      }
    }

    if (input.hook_event_name !== 'Stop') {
      return {}
    }

    // Catch modifications made by a tool not covered by PostToolUse.
    if (changed.length) {
      await writeFile(
        path.join(directory, `${id}-fix.log`),
        await autoFix(root, changed, execute)
      )
    }

    const before = await snapshot(root)
    const fingerprint = signature(before)
    state.observed = before

    if (
      fingerprint === state.baseline ||
      (state.validation?.ok && state.validation.fingerprint === fingerprint)
    ) {
      await save()
      return {}
    }

    let validation = state.validation

    if (!validation || validation.fingerprint !== fingerprint) {
      validation = await execute(root, 'pnpm', ['prepush'])

      if (signature(await snapshot(root)) !== fingerprint) {
        validation = {
          ok: false,
          output:
            'Files changed during validation; validate the new version before finishing.',
        }
      }

      await writeFile(
        path.join(directory, `${id}-validation.log`),
        validation.output
      )
      state.validation = { fingerprint, ok: validation.ok }
    }

    if (validation.ok) {
      await save()
      return {}
    }

    const log = path.join(directory, `${id}-validation.log`)

    if (state.blocked || input.stop_hook_active) {
      await save()
      return {
        systemMessage: `Quality checks still fail. Automatic continuation is limited to one attempt. Report the unresolved checks to the user. Log: ${log}`,
      }
    }

    state.blocked = true
    await save()
    return {
      decision: 'block',
      reason: `${continuation} Prettier, ESLint or types failed. Read ${log}, fix only issues in scope, then finish; the Stop hook will revalidate changed files. Do not repeatedly launch the same checks. If an environment problem or a decision blocks a fix, report it to the user.`,
    }
  } finally {
    await release()
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let input = {}

  try {
    let data = ''

    for await (const chunk of process.stdin) {
      data += chunk
    }

    input = JSON.parse(data)
    console.log(JSON.stringify(await runHook(input)))
  } catch (error) {
    const message = `Quality hook could not complete: ${error.message}`
    console.log(
      JSON.stringify(
        input.hook_event_name === 'Stop' && !input.stop_hook_active
          ? {
              decision: 'block',
              reason: `${continuation} ${message}. Resolve the environment problem or report that validation is incomplete.`,
            }
          : { systemMessage: message }
      )
    )
  }
}
