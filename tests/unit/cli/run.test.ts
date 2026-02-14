import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { recordingIo } from '../../../src/cli/output';
import { withDistrict } from '../../../src/cli/run';
import { cliHarness } from '../../support/cli';
import type { CliHarness } from '../../support/cli';

let harness: CliHarness | undefined;

afterEach(() => {
  harness?.close();
  harness = undefined;
});

function programFor(path: string): Command {
  const program = new Command();
  program
    .name('test')
    .option('-c, --config <path>', 'settings')
    .option('-f, --format <format>', 'text or json', 'text');
  program.setOptionValue('config', path);
  return program;
}

describe('the wrapper', () => {
  it('opens the district and closes it afterwards', async () => {
    harness = cliHarness();
    const io = recordingIo();
    const program = programFor(harness.configPath);
    let openWhileRunning = false;
    let closed: unknown;
    const action = withDistrict(program, io, ({ context, say }) => {
      openWhileRunning = context.db.open;
      closed = context.db;
      say('done', { done: true });
    });
    await action();
    expect(openWhileRunning).toBe(true);
    expect((closed as { open: boolean }).open).toBe(false);
    expect(io.text()).toBe('done');
  });

  it('closes the district when the handler throws', async () => {
    harness = cliHarness();
    const io = recordingIo();
    const program = programFor(harness.configPath);
    let held: unknown;
    const action = withDistrict(program, io, ({ context }) => {
      held = context.db;
      throw new Error('it broke');
    });
    await expect(action()).rejects.toThrow('it broke');
    expect((held as { open: boolean }).open).toBe(false);
  });

  it('passes the arguments through in order', async () => {
    harness = cliHarness();
    const io = recordingIo();
    const program = programFor(harness.configPath);
    const seen: string[] = [];
    const action = withDistrict(program, io, (_run, first: string, second: string) => {
      seen.push(first, second);
    });
    await action('one', 'two');
    expect(seen).toEqual(['one', 'two']);
  });

  it('reads the format the operator asked for', async () => {
    harness = cliHarness();
    const io = recordingIo();
    const program = programFor(harness.configPath);
    program.setOptionValue('format', 'json');
    const action = withDistrict(program, io, ({ format, say }) => {
      expect(format).toBe('json');
      say('text', { a: 1 });
    });
    await action();
    expect(JSON.parse(io.text())).toEqual({ a: 1 });
  });

  it('waits for an action that returns a promise', async () => {
    harness = cliHarness();
    const io = recordingIo();
    const program = programFor(harness.configPath);
    let finished = false;
    const action = withDistrict(program, io, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });
    await action();
    expect(finished).toBe(true);
  });
});
