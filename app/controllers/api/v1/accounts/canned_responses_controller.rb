class Api::V1::Accounts::CannedResponsesController < Api::V1::Accounts::BaseController
  before_action :fetch_canned_response, only: [:update, :destroy]

  def index
    render json: canned_responses
  end

  def create
    @canned_response = Current.account.canned_responses.new(canned_response_params)
    @canned_response.save!
    @canned_response.files.attach(uploaded_files) if uploaded_files.present?
    render json: @canned_response
  end

  def update
    @canned_response.update!(canned_response_params)
    @canned_response.files.attach(uploaded_files) if uploaded_files.present?
    attachments_to_remove.each { |id| @canned_response.files.find_by(id: id)&.purge }
    render json: @canned_response
  end

  def destroy
    @canned_response.destroy!
    head :ok
  end

  private

  def fetch_canned_response
    @canned_response = Current.account.canned_responses.find(params[:id])
  end

  def canned_response_params
    params.require(:canned_response).permit(:short_code, :content)
  end

  def uploaded_files
    params.require(:canned_response).permit(files: [])[:files]
  end

  def attachments_to_remove
    params.require(:canned_response).permit(remove_file_ids: [])[:remove_file_ids] || []
  end

  def canned_responses
    if params[:search]
      search = params[:search].delete("\0")
      Current.account.canned_responses
             .where('short_code ILIKE :search OR content ILIKE :search', search: "%#{search}%")
             .order_by_search(search)

    else
      Current.account.canned_responses
    end
  end
end
