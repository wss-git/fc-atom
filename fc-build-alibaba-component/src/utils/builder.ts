import { HLogger, ILogger, report } from '@serverless-devs/core';
import fs from 'fs-extra';
import path from 'path';
import _ from 'lodash';
import fcBuilders from '@alicloud/fc-builders';
import { execSync } from 'child_process';
import { checkCodeUri, getArtifactPath, getExcludeFilesEnv } from './utils';
import generateBuildContainerBuildOpts from './build-opts';
import { dockerRun } from './docker';
import { CONTEXT } from './constant';
import { IBuildInput, ICodeUri, IBuildDir, IObject } from '../interface';

interface INeedBuild {
  baseDir: string;
  runtime: string;
  codeUri?: string | ICodeUri;
}

interface IBuildOutput {
  image?: string;
  buildSaveUri?: string;
}

export default class Builder {
  @HLogger(CONTEXT) logger: ILogger;

  private commands: any;
  private parameters: any;
  projectName: string;

  constructor(projectName: string, commands: any[], parameters: IObject) {
    this.projectName = projectName;
    this.commands = commands;
    this.parameters = parameters;
  }

  async buildImage(buildInput: IBuildInput): Promise<string> {
    const { customContainer } = buildInput.functionProps;

    if (!customContainer) {
      const errorMessage = "No 'CustomContainer' configuration found in Function.";
      await report(errorMessage, {
        type: 'error',
        context: CONTEXT,
      });
      throw new Error(errorMessage);
    }

    const { d, dockerfile } = this.parameters;
    const dockerFileName = d || dockerfile || 'Dockerfile';
    if (!fs.existsSync(dockerFileName)) {
      const errorMessage = 'No dockerfile found.';
      await report(errorMessage, {
        type: 'error',
        context: CONTEXT,
      });
      throw new Error(errorMessage);
    }

    const imageName = customContainer.image;
    if (!imageName) {
      const errorMessage = 'Function/CustomContainer/Image required.';
      await report(errorMessage, {
        type: 'error',
        context: CONTEXT,
      });
      throw new Error(errorMessage);
    }

    try {
      this.logger.info('Building image...');
      execSync(`docker build -t ${imageName} -f ${dockerFileName} .`, {
        stdio: 'inherit',
      });
      this.logger.log(`Build image(${imageName}) successfully`);
      return imageName;
    } catch (e) {
      await report(e, {
        type: 'error',
        context: CONTEXT,
      });
      throw e;
    }
  }

  async build(buildInput: IBuildInput): Promise<IBuildOutput> {
    const useDocker = this.isUseDocker();
    if (useDocker) {
      this.logger.info('Use docker for building.');
    }
    const { functionProps } = buildInput;
    const { codeUri, runtime } = functionProps;
    const baseDir = process.cwd();

    this.logger.debug(`[${this.projectName}] Runtime is ${runtime}.`);

    if (useDocker && runtime === 'custom-container') {
      const image = await this.buildImage(buildInput);
      return { image };
    }

    const codeSkipBuild = await this.codeSkipBuild({ baseDir, codeUri, runtime });
    this.logger.debug(`[${this.projectName}] Code skip build: ${codeSkipBuild}.`);

    const src = checkCodeUri(codeUri);

    if (!codeSkipBuild) {
      return {};
    }

    let buildSaveUri: string;
    if (useDocker) {
      buildSaveUri = await this.buildInDocker(buildInput, src);
    } else {
      buildSaveUri = await this.buildArtifact(buildInput, src);
    }

    return { buildSaveUri };
  }

  async buildInDocker({
    region,
    serviceName,
    serviceProps,
    functionName,
    functionProps,
    verbose = true,
    credentials,
  }: IBuildInput, src: string): Promise<string> {
    const stages = ['install', 'build'];

    const baseDir = process.cwd();
    const codeUri = path.join(baseDir, src);
    const funcArtifactDir = this.initBuildArtifactDir({ baseDir, serviceName, functionName });

    const opts = await generateBuildContainerBuildOpts({
      region,
      serviceName,
      serviceProps,
      functionName,
      functionProps,
      baseDir,
      codeUri,
      funcArtifactDir,
      verbose,
      credentials,
      stages,
    });

    this.logger.debug(
      `[${this.projectName}] Generate Build Container Build Opts: ${JSON.stringify(opts)}`,
    );

    const usedImage = opts.Image;

    this.logger.info('Build function using image: ' + usedImage);

    const exitRs = await dockerRun(opts);
    if (exitRs.StatusCode !== 0) {
      const errorMessage = `build function ${serviceName}/${functionName} error.`;
      await report(errorMessage, {
        type: 'error',
        context: CONTEXT,
      });
      throw new Error(errorMessage);
    }
    return funcArtifactDir;
  }

  async buildArtifact(
    { serviceName, functionName, functionProps, verbose = true }: IBuildInput,
    src,
  ): Promise<string> {
    process.env.BUILD_EXCLIUDE_FILES = getExcludeFilesEnv();
    process.env.TOOL_CACHE_PATH = '.s';

    const baseDir = process.cwd();
    const { runtime } = functionProps;

    const stages = ['install', 'build'];
    const codePath = path.join(baseDir, src);

    const artifactPath = this.initBuildArtifactDir({ baseDir, serviceName, functionName });

    // detect fcfile
    const fcfilePath = path.resolve(codePath, 'fcfile');
    if (fs.existsSync(fcfilePath)) {
      this.logger.log(
        "Found fcfile in src directory, maybe you want to use 's build docker' ?",
        'yellow',
      );
    }

    const builder = new fcBuilders.Builder(
      serviceName,
      functionName,
      codePath,
      runtime,
      artifactPath,
      verbose,
      stages,
    );
    await builder.build();
    return artifactPath;
  }

  async codeSkipBuild({ baseDir, codeUri, runtime }: INeedBuild): Promise<boolean> {
    const src = checkCodeUri(codeUri);
    this.logger.debug(`src is: ${src}`);
    if (!src) {
      return false;
    }

    const absCodeUri = path.resolve(baseDir, src);
    const taskFlows = await fcBuilders.Builder.detectTaskFlow(runtime, absCodeUri);
    this.logger.debug(
      `taskFlows isEmpty: ${_.isEmpty(
        taskFlows,
      )},only default task flow is: ${this.isOnlyDefaultTaskFlow(taskFlows)}`,
    );
    this.logger.debug(JSON.stringify(taskFlows));
    if (_.isEmpty(taskFlows) || this.isOnlyDefaultTaskFlow(taskFlows)) {
      this.logger.info('No need build for this project.');
      return false;
    }

    return true;
  }

  isOnlyDefaultTaskFlow(taskFlows): boolean {
    if (taskFlows.length !== 1) {
      return false;
    }

    return taskFlows[0].name === 'DefaultTaskFlow';
  }

  initBuildArtifactDir({ baseDir, serviceName, functionName }: IBuildDir): string {
    const artifactPath = getArtifactPath({ baseDir, serviceName, functionName });

    this.logger.debug(`[${this.projectName}] Build save url: ${artifactPath}.`);

    if (fs.pathExistsSync(artifactPath)) {
      this.logger.debug(`[${this.projectName}] Folder already exists, delete folder.`);
      fs.rmdirSync(artifactPath, { recursive: true });
      this.logger.debug(`[${this.projectName}] Deleted folder successfully.`);
    }
    this.logger.debug(`[${this.projectName}] Create build folder.`);
    fs.mkdirpSync(artifactPath);
    this.logger.debug(`[${this.projectName}] Created build folder successfully.`);
    return artifactPath;
  }

  isUseDocker(): boolean {
    return this.commands[0] === 'docker';
  }
}
