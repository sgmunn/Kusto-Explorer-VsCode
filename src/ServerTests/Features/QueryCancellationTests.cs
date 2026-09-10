// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using Kusto.Vscode;

namespace Tests.Features;

[TestClass]
public class QueryCancellationTests
{
    [TestMethod]
    [DataRow("print 1")]
    [DataRow(".show version")]
    public async Task CancelledConnectionRequest_ThrowsBeforeAuthentication(string query)
    {
        var authentication = new CountingAuthenticationProvider();
        var manager = new ConnectionManager(authentication);
        var connection = manager.GetOrAddConnection("https://cancel-test.kusto.windows.net/testdb");
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        var error = await Assert.ThrowsExactlyAsync<OperationCanceledException>(
            () => connection.ExecuteAsync(query, cancellationToken: cancellation.Token));

        Assert.AreEqual(cancellation.Token, error.CancellationToken);
        Assert.AreEqual(0, authentication.CallCount);
    }

    [TestMethod]
    public async Task CancelledTypedRequest_PropagatesCancellationInsteadOfEmptyResults()
    {
        var manager = new ConnectionManager();
        var connection = manager.GetOrAddConnection("https://cancel-test.kusto.windows.net/testdb");
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsExactlyAsync<OperationCanceledException>(
            () => connection.ExecuteAsync<object>("print 1", cancellationToken: cancellation.Token));
    }

    private sealed class CountingAuthenticationProvider : IAuthenticationProvider
    {
        public int CallCount { get; private set; }

        public Task<string?> GetAccessTokenAsync(string clusterUri, CancellationToken cancellationToken)
        {
            CallCount++;
            throw new InvalidOperationException("A cancelled query must not start authentication.");
        }
    }
}
