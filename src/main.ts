import { getInput, setFailed } from "@actions/core";
import { exec, ExecOptions } from "@actions/exec";
import { IActionArguments } from "./types";
import commandExistsSync from "command-exists";
import stringArgv from "string-argv";
import { existsSync, promises } from "fs";
import { join } from "path";

// note: when updating also update README.md, action.yml
const default_rsync_options = "--archive --verbose --compress --human-readable --progress --delete-after --exclude=.git* --exclude=.git/ --exclude=README.md --exclude=readme.md --exclude=.gitignore";
const errorDeploying = "⚠️ Error deploying";

async function run() {
  try {
    const userArguments = getUserArguments();

    console.log(`----------------------------------------------------------------`);
    console.log(`🚀 Thanks for using web deploy. Let's deploy some stuff!`);
    console.log(`📑 Patched by MetaLabsMc. Added password authorization`);
    console.log(`----------------------------------------------------------------`);

    await verifyRsyncInstalled();

    if (userArguments.type_auth === "password") {
      console.log("✅ SSH-Авторизация с помощью пароля");
      await syncFilesWithPassword(userArguments);
    }
    else {
      console.log("✅ SSH-Авторизация с помощью приватного ключа");
      const privateKeyPath = await setupSSHPrivateKey(userArguments.private_ssh_key);
      await syncFilesWithPrivateKey(privateKeyPath, userArguments);
    }


    console.log("✅ Синхронизация завершена");
  }
  catch (error) {
    console.error(errorDeploying);
    setFailed(error as any);
  }
}

run();

function getUserArguments(): IActionArguments {
  return {
    target_server: getInput("target-server", { required: true }),
    destination_path: withDefault(getInput("destination-path", { required: false }), "./"),
    remote_user: getInput("remote-user", { required: true }),
    type_auth: withDefault(getInput("type-auth", { required: false }), "private_key"),
    private_ssh_key: getInput("private-ssh-key", { required: false }),
    ssh_password: getInput("ssh-password", { required: false }),
    source_path: withDefault(getInput("source-path", { required: false }), "./"),
    ssh_port: withDefault(getInput("ssh-port"), "22"),
    rsync_options: withDefault(getInput("rsync-options"), default_rsync_options)
  };
}

function withDefault(value: string, defaultValue: string) {
  if (value === "" || value === null || value === undefined) {
    return defaultValue;
  }

  return value;
}

/**
 * Sync changed files with password
 */
export async function syncFilesWithPassword(args: IActionArguments) {
  try {
    const rsyncArguments: string[] = [];

    rsyncArguments.push(
        ...stringArgv(
            `-e 'sshpass -p "${args.ssh_password}" ssh -p ${args.ssh_port} -o StrictHostKeyChecking=no'`
        )
    );

    rsyncArguments.push('--update');
    rsyncArguments.push('--recursive');

    rsyncArguments.push(...stringArgv(args.rsync_options));

    if (args.source_path !== undefined) {
      rsyncArguments.push(args.source_path);
    }

    const destination = `${args.remote_user}@${args.target_server}:${args.destination_path}`;
    rsyncArguments.push(destination);

    return await exec(
        "rsync",
        rsyncArguments,
        mapOutput
    );
  } catch (error) {
    setFailed(error as any);
  }
}

/**
 * Sync changed files with private key
 */
export async function syncFilesWithPrivateKey(privateKeyPath: string, args: IActionArguments) {
  try {
    const rsyncArguments: string[] = [];

    rsyncArguments.push(...stringArgv(`-e 'ssh -p ${args.ssh_port} -i ${privateKeyPath} -o StrictHostKeyChecking=no'`));

    rsyncArguments.push(...stringArgv(args.rsync_options));

    if (args.source_path !== undefined) {
      rsyncArguments.push(args.source_path);
    }

    const destination = `${args.remote_user}@${args.target_server}:${args.destination_path}`;
    rsyncArguments.push(destination);

    return await exec(
        "rsync",
        rsyncArguments,
        mapOutput
    );
  }
  catch (error) {
    setFailed(error as any);
  }
}

async function verifyRsyncInstalled() {
  try {
    await commandExistsSync("rsync");

    // command exists, continue
    return;
  }
  catch (commandExistsError) {
    throw new Error("rsync not installed. For instructions on how to fix see https://github.com/SamKirkland/web-deploy#rsync-not-installed");
  }
};

const {
  HOME,
  GITHUB_WORKSPACE
} = process.env;

export async function setupSSHPrivateKey(key: string) {
  const sshFolderPath = join(HOME || __dirname, '.ssh');
  const privateKeyPath = join(sshFolderPath, "web_deploy_key");

  console.log("HOME", HOME);
  console.log("GITHUB_WORKSPACE", GITHUB_WORKSPACE);

  await promises.mkdir(sshFolderPath, { recursive: true });

  const knownHostsPath = `${sshFolderPath}/known_hosts`;

  if (!existsSync(knownHostsPath)) {
    console.log(`[SSH] Создание "${knownHostsPath}" в `, GITHUB_WORKSPACE);
    await promises.writeFile(knownHostsPath, "", {
      encoding: 'utf8',
      mode: 0o600
    });
    console.log('✅ [SSH] Файл создан');
  } else {
    console.log(`[SSH] "${knownHostsPath}" уже существует`);
  }

  await promises.writeFile(privateKeyPath, key, {
    encoding: 'utf8',
    mode: 0o600
  });
  console.log('✅ SSH ключ добавлен в ', privateKeyPath);

  return privateKeyPath;
};

export const mapOutput: ExecOptions = {
  listeners: {
    stdout: (data: Buffer) => {
      console.log(data);
    },
    stderr: (data: Buffer) => {
      console.error(data);
    },
  }
};