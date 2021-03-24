import { HLogger, ILogger, loadComponent } from '@serverless-devs/core';
import _ from 'lodash';
import { CONTEXT } from './constant';
import transformInputs from './transformInputs';

export default class Component {
  @HLogger(CONTEXT) logger: ILogger;

  async deploy(inputs) {
    const webFrameworkInputs = transformInputs(_.cloneDeep(inputs));

    const webFramework = await loadComponent('alibaba/web-framework');
    return await webFramework.deploy(webFrameworkInputs);
  }

  async remove(inputs) {
    const webFrameworkInputs = transformInputs(_.cloneDeep(inputs));

    const webFramework = await loadComponent('alibaba/web-framework');
    return await webFramework.remove(webFrameworkInputs);
  }

  async build(inputs) {
    const webFrameworkInputs = transformInputs(_.cloneDeep(inputs));
    webFrameworkInputs.Properties.function.runtime = 'nodejs12';

    const webFramework = await loadComponent('alibaba/web-framework');
    return await webFramework.build(webFrameworkInputs);
  }
}
