// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

using System.Data;
using System.Reflection;
using Kusto.Data.Common;
using Kusto.Vscode;

namespace Tests.Features;

[TestClass]
public class QueryCancellationTests
{
    [TestMethod]
    public async Task RunningQuery_ReceivesCancellationAndPropagatesIt()
    {
        var manager = new ConnectionManager();
        var connection = manager.GetOrAddConnection("https://cancel-test.kusto.windows.net/testdb");
        using var provider = DispatchProxy.Create<ICslQueryProvider, PendingQueryProvider>();
        var pending = (PendingQueryProvider)(object)provider;
        var providerField = connection.GetType().GetField("_primaryQueryProvider", BindingFlags.Instance | BindingFlags.NonPublic);
        Assert.IsNotNull(providerField);
        providerField.SetValue(connection, provider);
        using var cancellation = new CancellationTokenSource();

        var run = connection.ExecuteAsync("print 1", cancellationToken: cancellation.Token);
        Assert.AreEqual(cancellation.Token, pending.Token, "The SDK query must receive the caller's token.");
        Assert.IsFalse(run.IsCompleted);
        cancellation.Cancel();

        await Assert.ThrowsAsync<OperationCanceledException>(() => run);
        Assert.AreEqual(1, pending.CallCount, "Cancellation must not retry the query.");
    }

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

    public class PendingQueryProvider : DispatchProxy
    {
        public CancellationToken Token { get; private set; }
        public int CallCount { get; private set; }
        private CancellationTokenRegistration registration;

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod?.Name == nameof(IDisposable.Dispose))
            {
                registration.Dispose();
                return null;
            }
            if (targetMethod?.Name != nameof(ICslQueryProvider.ExecuteQueryAsync))
            {
                throw new InvalidOperationException($"Unexpected SDK call: {targetMethod?.Name}");
            }
            CallCount++;
            Token = args!.OfType<CancellationToken>().Single();
            var completion = new TaskCompletionSource<IDataReader>(TaskCreationOptions.RunContinuationsAsynchronously);
            registration = Token.Register(() => completion.TrySetCanceled(Token));
            return completion.Task;
        }
    }
}
