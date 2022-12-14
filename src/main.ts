import * as core from '@actions/core'
import * as cp from 'child_process'
import * as fs from 'fs'
import * as installer from './installer'
import * as os from 'os'
import * as path from 'path'
import * as tc from '@actions/tool-cache'
import * as util from 'util'
import {IS_POST} from './state-helper'

export const execer = util.promisify(cp.exec)

async function run(): Promise<void> {
  try {
    //
    // Version is optional.  If supplied, install / use from the tool cache
    // If not supplied then task is still used to setup proxy, auth, etc...
    //
    const version = resolveVersionInput()

    let arch = core.getInput('architecture')

    // if architecture supplied but version is not
    // if we don't throw a warning, the already installed x64 node will be used which is not probably what user meant.
    if (arch && !version) {
      core.warning(
        '`architecture` is provided but `version` is missing. In this configuration, the version/architecture of Node will not be changed. To fix this, provide `architecture` in combination with `version`'
      )
    }

    if (!arch) {
      arch = os.arch()
    }

    const token = core.getInput('token', {required: true})
    const stable = strToBoolean(core.getInput('stable') || 'false')
    const checkLatest = strToBoolean(core.getInput('check-latest') || 'false')

    const binPath = await installer.getVlang({
      authToken: token,
      version,
      checkLatest,
      stable,
      arch
    })

    core.info('Adding v to the cache...')
    const installedVersion = await getVersion(binPath)
    const cachedPath = await tc.cacheDir(binPath, 'v', installedVersion)
    core.info(`Cached v to: ${cachedPath}`)

    core.addPath(cachedPath)

    const vBinPath = path.join(binPath, 'v')
    core.setOutput('bin-path', binPath)
    core.setOutput('v-bin-path', vBinPath)
    core.setOutput('version', installedVersion)
    core.setOutput('architecture', arch)
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message)
  }
}

export async function cleanup(): Promise<void> {
  // @todo: implement
}

function resolveVersionInput(): string {
  let version = core.getInput('version')
  const versionFileInput = core.getInput('version-file')

  if (version && versionFileInput) {
    core.warning(
      'Both version and version-file inputs are specified, only version will be used'
    )
  }

  if (versionFileInput) {
    const versionFilePath = path.join(
      process.env.GITHUB_WORKSPACE!,
      versionFileInput
    )
    if (!fs.existsSync(versionFilePath)) {
      throw new Error(
        `The specified v version file at: ${versionFilePath} does not exist`
      )
    }
    version = fs.readFileSync(versionFilePath, 'utf8')
  }

  version = parseVersionFile(version)
  core.info(`Resolved ${versionFileInput} as ${version}`)

  return version
}

function parseVersionFile(contents: string): string {
  let version = contents.trim()

  if (/^v\d/.test(version)) {
    version = version.substring(1)
  }

  return version
}

function strToBoolean(str: string): boolean {
  const falsyValues = ['false', 'no', '0', '', 'undefined', 'null']

  return !falsyValues.includes(str.toLowerCase())
}

async function getVersion(binPath: string): Promise<string> {
  const vBinPath = path.join(binPath, 'v')

  const {stdout, stderr} = await execer(`${vBinPath} version`)

  if (stderr !== '') {
    throw new Error(`Unable to get version from ${vBinPath}`)
  }

  if (stdout !== '') {
    return stdout.trim().split(' ')[1]
  }

  core.warning('Unable to get version from v executable.')
  return '0.0.0'
}

if (IS_POST) {
  cleanup()
} else {
  run()
}
