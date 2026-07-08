import { context, propagation, type TextMapSetter } from '@opentelemetry/api';

type Carrier = Headers | Record<string, string>;

const setter: TextMapSetter<Carrier> = {
  set(carrier, key, value) {
    if (carrier instanceof Headers) carrier.set(key, value);
    else carrier[key] = value;
  },
};

/** Inject the active trace context (x-trace-id + traceparent) into outbound HTTP
 *  headers for internal service-to-service calls. */
export function injectTraceHeaders(headers: Carrier): void {
  propagation.inject(context.active(), headers, setter);
}
