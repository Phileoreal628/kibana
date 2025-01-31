/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { DataView, DataViewsContract, getTime } from '@kbn/data-plugin/common';
import { parseAggregationResults } from '@kbn/triggers-actions-ui-plugin/common';
import { SharePluginStart } from '@kbn/share-plugin/server';
import { IScopedClusterClient, Logger } from '@kbn/core/server';
import { OnlyEsqlQueryRuleParams } from '../types';
import { EsqlTable, toEsQueryHits } from '../../../../common';

export interface FetchEsqlQueryOpts {
  ruleId: string;
  alertLimit: number | undefined;
  params: OnlyEsqlQueryRuleParams;
  spacePrefix: string;
  publicBaseUrl: string;
  services: {
    logger: Logger;
    scopedClusterClient: IScopedClusterClient;
    share: SharePluginStart;
    dataViews: DataViewsContract;
  };
}

export async function fetchEsqlQuery({
  ruleId,
  alertLimit,
  params,
  services,
  spacePrefix,
  publicBaseUrl,
}: FetchEsqlQueryOpts) {
  const { logger, scopedClusterClient, dataViews } = services;
  const esClient = scopedClusterClient.asCurrentUser;
  const dataView = await dataViews.create({
    timeFieldName: params.timeField,
  });

  const { query, dateStart, dateEnd } = getEsqlQuery(dataView, params, alertLimit);

  logger.debug(`ES|QL query rule (${ruleId}) query: ${JSON.stringify(query)}`);

  const response = await esClient.transport.request<EsqlTable>({
    method: 'POST',
    path: '/_esql',
    body: query,
  });

  const link = `${publicBaseUrl}${spacePrefix}/app/management/insightsAndAlerting/triggersActions/rule/${ruleId}`;

  return {
    link,
    numMatches: Number(response.values.length),
    parsedResults: parseAggregationResults({
      isCountAgg: true,
      isGroupAgg: false,
      esResult: {
        took: 0,
        timed_out: false,
        _shards: { failed: 0, successful: 0, total: 0 },
        hits: toEsQueryHits(response),
      },
      resultLimit: alertLimit,
    }),
    dateStart,
    dateEnd,
  };
}

export const getEsqlQuery = (
  dataView: DataView,
  params: OnlyEsqlQueryRuleParams,
  alertLimit: number | undefined
) => {
  const timeRange = {
    from: `now-${params.timeWindowSize}${params.timeWindowUnit}`,
    to: 'now',
  };
  const timerangeFilter = getTime(dataView, timeRange);
  const dateStart = timerangeFilter?.query.range[params.timeField].gte;
  const dateEnd = timerangeFilter?.query.range[params.timeField].lte;
  const rangeFilter: unknown[] = [
    {
      range: {
        [params.timeField]: {
          lte: dateEnd,
          gt: dateStart,
          format: 'strict_date_optional_time',
        },
      },
    },
  ];

  const query = {
    query: alertLimit ? `${params.esqlQuery.esql} | limit ${alertLimit}` : params.esqlQuery.esql,
    filter: {
      bool: {
        filter: rangeFilter,
      },
    },
  };
  return {
    query,
    dateStart,
    dateEnd,
  };
};
