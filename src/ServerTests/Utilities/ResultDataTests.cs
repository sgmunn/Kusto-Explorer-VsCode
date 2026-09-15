// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

namespace Tests.Utilities;

using System.Collections.Immutable;
using Kusto.Vscode;

[TestClass]
public class ResultDataTests
{
    [TestMethod]
    public void FromExecuteResultPreservesQueryParameters()
    {
        var parameters = ImmutableDictionary<string, string>.Empty
            .Add("startTime", "datetime(2026-09-01)")
            .Add("region", "westus");

        var result = ResultData.FromExecuteResult(
            new ExecuteResult(),
            query: "Events | take 10",
            parameters: parameters);

        CollectionAssert.AreEquivalent(parameters, result.Parameters);
    }
}