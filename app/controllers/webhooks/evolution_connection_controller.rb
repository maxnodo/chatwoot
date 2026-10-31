# frozen_string_literal: true

require 'digest'

class Webhooks::EvolutionConnectionController < PublicController
  before_action :set_channel
  before_action :verify_connection_secret

  def create
    state = normalized_state
    return render json: { error: 'Unsupported Evolution connection state' }, status: :unprocessable_entity unless state

    attributes = @channel.additional_attributes.to_h.merge(
      'connection_status' => state,
      'connection_status_checked_at' => Time.current.iso8601
    )

    @channel.update_columns(additional_attributes: attributes, updated_at: Time.current) # rubocop:disable Rails/SkipsModelValidations
    head :no_content
  end

  private

  def set_channel
    @channel = Channel::Api.find_by!(identifier: params[:inbox_identifier])
  end

  def verify_connection_secret
    expected_secret = @channel.secret.to_s
    supplied_secret = request.headers['X-Evolution-Connection-Secret'].to_s
    valid_secret = expected_secret.present? && supplied_secret.present? &&
                   ActiveSupport::SecurityUtils.secure_compare(
                     Digest::SHA256.hexdigest(expected_secret),
                     Digest::SHA256.hexdigest(supplied_secret)
                   )
    return if valid_secret

    head :unauthorized
  end

  def normalized_state
    raw_state = params[:state].presence || params.dig(:data, :state).presence || params.dig(:data, :connection).presence

    case raw_state.to_s.downcase
    when 'connected', 'open'
      'connected'
    when 'close', 'closed', 'disconnected'
      'disconnected'
    end
  end
end
