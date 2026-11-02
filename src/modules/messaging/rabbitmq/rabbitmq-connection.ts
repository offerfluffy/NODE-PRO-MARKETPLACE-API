import { connect, type Channel } from 'amqplib';

type ChannelWork<Result> = (channel: Channel) => Promise<Result>;

export async function withRabbitChannel<Result>(
  brokerUrl: string,
  work: ChannelWork<Result>,
): Promise<Result> {
  const connection = await connect(brokerUrl);

  try {
    const channel = await connection.createChannel();

    try {
      return await work(channel);
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}
