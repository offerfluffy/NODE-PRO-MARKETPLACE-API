import { io } from 'socket.io-client';

const sameRoom = process.argv.includes('--same-room');

const baseUrl = process.env.REALTIME_API ?? 'http://localhost:3000';

const orderAId = process.env.ORDER_A_ID ?? '1';
const orderBId = process.env.ORDER_B_ID ?? '2';

const roomBId = sameRoom ? orderAId : orderBId;

async function loadOrder(orderId) {
  const response = await fetch(`${baseUrl}/orders/${orderId}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Failed to load order ${orderId}: HTTP ${response.status}`);
  }

  const order = await response.json();

  if (
    typeof order !== 'object' ||
    order === null ||
    typeof order.customer_id !== 'string' ||
    typeof order.status !== 'string'
  ) {
    throw new Error(`Invalid response for order ${orderId}`);
  }

  return order;
}

async function updateOrderStatus(orderId, status) {
  const response = await fetch(`${baseUrl}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ status }),
    signal: AbortSignal.timeout(5000),
  });

  if (response.status !== 204) {
    throw new Error(
      `Failed to update order ${orderId}: HTTP ${response.status}`,
    );
  }
}

function connectClient(userId) {
  const socket = io(baseUrl, {
    auth: { userId },
    autoConnect: false,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error(`Timed out connecting client ${userId}`));
    }, 5000);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
    }

    function handleConnect() {
      cleanup();
      resolve(socket);
    }

    function handleConnectError(error) {
      cleanup();
      socket.disconnect();
      reject(error);
    }

    socket.once('connect', handleConnect);
    socket.once('connect_error', handleConnectError);
    socket.connect();
  });
}

function joinOrder(socket, orderId) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit('join', { orderId }, (timeoutError, ack) => {
      if (timeoutError) {
        reject(new Error(`Timed out joining order ${orderId}`));
        return;
      }

      if (!ack?.ok) {
        reject(
          new Error(
            `Failed to join order ${orderId}: ${ack?.error ?? 'unknown'}`,
          ),
        );
        return;
      }

      resolve(ack.room);
    });
  });
}

const orderA = await loadOrder(orderAId);
const orderB = roomBId === orderAId ? orderA : await loadOrder(roomBId);

const userAId = orderA.customer_id;
const userBId = orderB.customer_id;

const [clientA, clientB] = await Promise.all([
  connectClient(userAId),
  connectClient(userBId),
]);

await Promise.all([joinOrder(clientA, orderAId), joinOrder(clientB, roomBId)]);

let aReceived = 0;
let bReceived = 0;

clientA.on('order.status', (event) => {
  if (event?.orderId === orderAId) {
    aReceived += 1;
  }
});

clientB.on('order.status', (event) => {
  if (event?.orderId === orderAId) {
    bReceived += 1;
  }
});

const nextStatus = orderA.status === 'paid' ? 'completed' : 'paid';
await updateOrderStatus(orderAId, nextStatus);

await new Promise((resolve) => setTimeout(resolve, 500));

console.log(`A_RECEIVED=${aReceived}`);
console.log(`B_RECEIVED=${bReceived}`);

const expectedB = sameRoom ? 1 : 0;
const passed = aReceived === 1 && bReceived === expectedB;

clientA.disconnect();
clientB.disconnect();

if (!passed) {
  process.exitCode = 1;
}