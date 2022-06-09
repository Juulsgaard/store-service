
export function logSuccessfulAction(name: string, warning: string | undefined, startedAt: number | undefined, payload: any, data: any) {
  const time = startedAt && Date.now() - startedAt;
  const style = warning ? 'font-weight: bold; color: orange' : 'font-weight: bold';

  console.groupCollapsed(`%c${name}${warning ? ' [!]' : ''}`, style);
  if (warning) console.log('%cWarning: ', style, warning);
  console.log('%cPayload: ', style, payload);
  console.log('%cReturn: ', style, data);
  if (time) console.log('%cTime: ', style, time < 1000 ? '< 1s' : `${time / 1000}s`);
  console.groupEnd();
}

export function logFailedAction(name: string, startedAt: number | undefined, payload: any, error: Error) {
  const time = startedAt && Date.now() - startedAt;
  const style = 'font-weight: bold; color: red';

  console.groupCollapsed(`%c${name} [!!]`, style);
  console.log('%cPayload: ', style, payload);
  console.log('%cError: ', style, error.message);
  if (time) console.log('%cTime: ', style, time < 1000 ? '< 1s' : `${time / 1000}s`);
  if (error.stack) console.log('%cStack: ', style, error.stack);
  if ((error as {correlationId?: string}).correlationId) console.log('%cCorrelation Id: ', style, (error as {correlationId?: string}).correlationId);
  console.groupEnd();
}
