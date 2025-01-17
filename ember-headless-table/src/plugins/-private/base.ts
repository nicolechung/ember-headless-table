import { assert } from '@ember/debug';

import { TABLE_KEY } from '../../-private/table';
import { normalizePluginsConfig } from './utils';

import type { Table } from '../../-private/table';
import type { ColumnReordering } from '../column-reordering';
import type { ColumnVisibility } from '../column-visibility';
import type { Class, Constructor } from '[private-types]';
import type { Column, Row } from '[public-types]';
import type {
  ColumnMetaFor,
  ColumnOptionsFor,
  OptionsFor,
  Plugin,
  RowMetaFor,
  TableMetaFor,
} from '#interfaces';

const TABLE_META = new Map<string, Map<Class<unknown>, any>>();
const COLUMN_META = new WeakMap<Column, Map<Class<unknown>, any>>();
const ROW_META = new WeakMap<Row, Map<Class<unknown>, any>>();

type InstanceOf<T> = T extends Class<infer Instance> ? Instance : T;

/**
 * @public
 *
 * list of interfaces by feature name that consumers may provide alternative
 * implementation for
 */
export interface TableFeatures extends Record<string, unknown | undefined> {
  /**
   * @public
   *
   * interface for the table meta of a "column visibility plugin"
   */
  columnVisibility: InstanceOf<ColumnVisibility['meta']['table']>;
  /**
   * @public
   *
   * interface for the table meta of a "column order plugin"
   */
  columnOrder: InstanceOf<ColumnReordering['meta']['table']>;
}

/**
 * @public
 *
 * list of interfaces by feature name that consumers may provide alternative
 * implementation for
 */
export interface ColumnFeatures extends Record<string, unknown | undefined> {
  /**
   * @public
   *
   * interface for the column meta of a "column visibility plugin"
   */
  columnVisibility: InstanceOf<ColumnVisibility['meta']['column']>;
  /**
   * @public
   *
   * interface for the column meta of a "column order plugin"
   */
  columnOrder: InstanceOf<ColumnReordering['meta']['column']>;
}

/**
 * @private utility type
 *
 */
export type SignatureFrom<Klass extends BasePlugin<any>> = Klass extends BasePlugin<infer Signature>
  ? Signature
  : never;

declare const __Signature__: unique symbol;

/**
 * @public
 *
 * If your table plugin is a class, you may extend from BasePlugin, which provides
 * small utility methods and properties for getting the metadata for your plugin
 * for the table and each column
 *
 * One instance of a plugin exists per table
 */
export abstract class BasePlugin<Signature = unknown> implements Plugin<Signature> {
  constructor(protected table: Table) {}

  /**
   * @private (secret)
   *
   * Because classes are kind of like interfaces,
   * we need "something" to help TS know what a Resource is.
   *
   * This isn't a real API, but does help with type inference
   * with the SignatureFrom utility above
   */
  declare [__Signature__]: Signature;

  /**
   * Helper for specifying plugins on `headlessTable` with the plugin-level options
   */
  static with<T extends BasePlugin<any>>(
    this: Constructor<T>,
    configFn: () => OptionsFor<SignatureFrom<T>>
  ): [Constructor<T>, () => OptionsFor<SignatureFrom<T>>] {
    return [this, configFn];
  }

  /**
   * Helper for specifying column-level configurations for a plugin on `headlessTable`'s
   * columns option
   */
  static forColumn<T extends BasePlugin<any>>(
    this: Constructor<T>,
    configFn: () => ColumnOptionsFor<SignatureFrom<T>>
  ): [Constructor<T>, () => ColumnOptionsFor<SignatureFrom<T>>] {
    return [this, configFn];
  }

  declare meta?: {
    column?: Constructor<ColumnMetaFor<Signature>>;
    table?: Constructor<TableMetaFor<Signature>>;
    row?: Constructor<RowMetaFor<Signature>>;
  };

  abstract name: string;
  static features?: string[];
  static requires?: string[];
}

export const preferences = {
  /**
   * @public
   *
   * returns an object for getting and setting preferences data
   * based on the column (scoped to key)
   *
   * Only the provided plugin will have access to these preferences
   * (though, if other plugins can guess how the underlying plugin access
   * works, they can access this data, too. No security guaranteed)
   */
  forColumn<P extends BasePlugin<any>, Data = unknown>(column: Column<Data>, klass: Class<P>) {
    return {
      /**
       * delete an entry on the underlying `Map` used for this column-plugin pair
       */
      delete(key: string) {
        let prefs = column.table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);
        let columnPrefs = existing.forColumn(column.key);

        columnPrefs.delete(key);

        return prefs.persist();
      },
      /**
       * get an entry on the underlying `Map` used for this column-plugin pair
       */
      get(key: string) {
        let prefs = column.table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);
        let columnPrefs = existing.forColumn(column.key);

        return columnPrefs.get(key);
      },
      /**
       * set an entry on the underlying `Map` used for this column-plugin pair
       */
      set(key: string, value: unknown) {
        let prefs = column.table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);
        let columnPrefs = existing.forColumn(column.key);

        columnPrefs.set(key, value);

        prefs.persist();
      },
    };
  },

  /**
   * @public
   *
   * returns an object for getting and setting preferences data
   * based on the table (scoped to the key: "table")
   *
   * Only the provided plugin will have access to these preferences
   * (though, if other plugins can guess how the underlying plugin access
   * works, they can access this data, too. No security guaranteed)
   */
  forTable<P extends BasePlugin<any>, Data = unknown>(table: Table<Data>, klass: Class<P>) {
    return {
      /**
       * delete an entry on the underlying `Map` used for this column-plugin pair
       */
      delete(key: string) {
        let prefs = table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);

        existing.table.delete(key);

        return prefs.persist();
      },
      /**
       * get an entry on the underlying `Map` used for this column-plugin pair
       */
      get(key: string) {
        let prefs = table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);

        return existing.table.get(key);
      },
      /**
       * set an entry on the underlying `Map` used for this column-plugin pair
       */
      set(key: string, value: unknown) {
        let prefs = table.preferences;
        let existing = prefs.storage.forPlugin(klass.name);

        existing.table.set(key, value);

        return prefs.persist();
      },
    };
  },
};

export const meta = {
  /**
   * @public
   *
   * For a given column and plugin, return the meta / state bucket for the
   * plugin<->column instance pair.
   *
   * Note that this requires the column instance to exist on the table.
   */
  forColumn<P extends BasePlugin<any>, Data = unknown>(
    column: Column<Data>,
    klass: Class<P>
  ): ColumnMetaFor<SignatureFrom<P>> {
    return getPluginInstance(COLUMN_META, column, klass, () => {
      let plugin = column.table.pluginOf(klass);

      assert(`[${klass.name}] cannot get plugin instance of unregistered plugin class`, plugin);
      assert(`<#${plugin.name}> plugin does not have meta specified`, plugin.meta);
      assert(`<#${plugin.name}> plugin does not specify column meta`, plugin.meta.column);

      return new plugin.meta.column(column);
    });
  },

  /**
   * @public
   *
   * For a given row and plugin, return the meta / state bucket for the
   * plugin<->row instance pair.
   *
   * Note that this requires the row instance to exist on the table.
   */
  forRow<P extends BasePlugin<any>, Data = unknown>(
    row: Row<Data>,
    klass: Class<P>
  ): RowMetaFor<SignatureFrom<P>> {
    return getPluginInstance(ROW_META, row, klass, () => {
      let plugin = row.table.pluginOf(klass);

      assert(`[${klass.name}] cannot get plugin instance of unregistered plugin class`, plugin);
      assert(`<#${plugin.name}> plugin does not have meta specified`, plugin.meta);
      assert(`<#${plugin.name}> plugin does not specify row meta`, plugin.meta.row);

      return new plugin.meta.row(row);
    });
  },

  /**
   * @public
   *
   * For a given table and plugin, return the meta / state bucket for the
   * plugin<->table instance pair.
   */
  forTable<P extends BasePlugin<any>, Data = unknown>(
    table: Table<Data>,
    klass: Class<P>
  ): TableMetaFor<SignatureFrom<P>> {
    return getPluginInstance(TABLE_META, table[TABLE_KEY], klass, () => {
      let plugin = table.pluginOf(klass);

      assert(`[${klass.name}] cannot get plugin instance of unregistered plugin class`, plugin);
      assert(`<#${plugin.name}> plugin does not have meta specified`, plugin.meta);
      assert(`<#${plugin.name}> plugin does not specify table meta`, plugin.meta.table);
      assert(
        `<#${plugin.name}> plugin already exists for the table. ` +
          `A plugin may only be instantiated once per table.`,
        ![...(TABLE_META.get(table[TABLE_KEY])?.keys() ?? [])].includes(klass)
      );

      return new plugin.meta.table(table);
    });
  },

  /**
   * Instead of finding meta based on column or table instances,
   * you can search for meta based on feature strings, such as `columnWidth`
   */
  withFeature: {
    /**
     * @public
     *
     * for a given column and feature name, return the "ColumnMeta" for that feature.
     * This is useful when plugins may depend on one another but may not necessarily care which
     * plugin is providing what behavior.
     *
     * For example, multiple column-focused plugins may care about width or visibility
     */
    forColumn<FeatureName extends string, Data = unknown>(
      column: Column<Data>,
      featureName: FeatureName
    ): ColumnFeatures[FeatureName] {
      let { plugins } = column.table;

      let provider = findPlugin(plugins, featureName);

      assert(
        `Could not find plugin with feature: ${featureName}. ` +
          `Available features: ${availableFeatures(plugins)}`,
        provider
      );

      // TS doesn't believe in the constructor property?
      return meta.forColumn(column, (provider as any).constructor);
    },

    /**
     * @public
     *
     * for a given table and feature name, return the "TableMeta" for that feature.
     * This is useful when plugins may depend on one another but may not necessarily care
     * which plugin is providing that behavior.
     *
     * For example, multiple column-focused plugins may care about width or visibility.
     */
    forTable<FeatureName extends string, Data = unknown>(
      table: Table<Data>,
      featureName: FeatureName
    ): TableFeatures[FeatureName] {
      let { plugins } = table;

      let provider = findPlugin(plugins, featureName);

      assert(
        `Could not find plugin with feature: ${featureName}. ` +
          `Available features: ${availableFeatures(plugins)}`,
        provider
      );

      // TS doesn't believe in the constructor property?
      return meta.forTable(table, (provider as any).constructor);
    },
  },
};

function findPlugin(plugins: Plugin[], featureName: string) {
  let provider = plugins.find((plugin) => {
    /*
     * have to cast in order to get static properties, but we may not have a base plugin
     * so we must rely on nullish coalesting to protect from throwing exceptions
     *
     * (Plugin || BasePlugin).features)
     */
    let features = plugin.features || (plugin.constructor as typeof BasePlugin).features;

    return features?.includes(featureName);
  });

  return provider;
}

function availableFeatures(plugins: Plugin[]): string {
  let allFeatures = plugins
    .map((plugin) => {
      /*
       * have to cast in order to get static properties, but we may not have a base plugin
       * so we must rely on nullish coalesting to protect from throwing exceptions
       *
       * (Plugin || BasePlugin).features)
       */
      let features = plugin.features || (plugin.constructor as typeof BasePlugin).features;

      return features;
    })
    .flat()
    .filter(Boolean);

  return allFeatures.length > 0 ? allFeatures.join(', ') : '[none]';
}

export const options = {
  /**
   * @public
   *
   * For a given table and plugin, return the options, if any were given from the user
   * during construction of the table.
   */
  forTable<P extends BasePlugin<any>, Data = unknown>(
    table: Table<Data>,
    klass: Class<P>
  ): Partial<OptionsFor<SignatureFrom<P>>> {
    let normalized = normalizePluginsConfig(table?.config?.plugins);
    let tuple = normalized?.find((option) => option[0] === klass);
    let t = tuple as [Class<P>, () => OptionsFor<SignatureFrom<P>>];

    // Plugin not provided, likely
    if (!t) return {};

    let fn = t[1];

    return fn() ?? {};
  },

  forColumn<P extends BasePlugin<any>, Data = unknown>(
    column: Column<Data>,
    klass: Class<P>
  ): Partial<ColumnOptionsFor<SignatureFrom<P>>> {
    let tuple = column.config.pluginOptions?.find((option) => option[0] === klass);
    let t = tuple as [unknown, () => ColumnOptionsFor<SignatureFrom<P>>];

    let fn = t?.[1];

    if (!fn) return {};

    return fn() ?? {};
  },
};

/**
 * @private
 */
function getPluginInstance<RootKey extends string | Column<any> | Row<any>, Instance>(
  map: RootKey extends string
    ? Map<string, Map<Class<Instance>, Instance>>
    : WeakMap<Column | Row, Map<Class<Instance>, Instance>>,
  rootKey: RootKey,
  mapKey: Class<Instance>,
  factory: () => Instance
): Instance {
  let bucket: Map<Class<Instance>, Instance> | undefined;

  if (map instanceof WeakMap) {
    assert(`Cannot use string key with WeakMap`, typeof rootKey !== 'string');

    bucket = map.get(rootKey);

    if (!bucket) {
      bucket = new Map();

      map.set(rootKey, bucket);
    }
  } else {
    assert(`Cannot use object key with Map`, typeof rootKey === 'string');
    bucket = map.get(rootKey);

    if (!bucket) {
      bucket = new Map();

      map.set(rootKey, bucket);
    }
  }

  let instance = bucket.get(mapKey);

  if (instance) {
    return instance;
  }

  instance = factory();

  bucket.set(mapKey, instance);

  return instance;
}
